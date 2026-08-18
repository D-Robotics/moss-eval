#!/usr/bin/env node
import { spawn } from 'node:child_process';
import readline from 'node:readline';

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    result[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  }
  return result;
}

const options = argumentsOf(process.argv.slice(2));
if (!options.server || !options.prompt) {
  throw new Error('Usage: acp-client --server moss --cwd <dir> --prompt <text>');
}

const serverArgs = options['server-args'] ? JSON.parse(options['server-args']) : ['agent', 'stdio'];
if (!Array.isArray(serverArgs) || serverArgs.some((item) => typeof item !== 'string')) {
  throw new Error('--server-args must be a JSON string array');
}
const server = spawn(options.server, serverArgs, {
  cwd: options.cwd || process.cwd(),
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
const lines = readline.createInterface({ input: server.stdout });
let requestId = 0;
const pending = new Map();
let finalText = '';

function wire(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

function send(message) {
  server.stdin.write(JSON.stringify(message) + '\n');
}

function request(method, params) {
  const id = ++requestId;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function textFrom(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFrom).join('');
  if (value.type === 'text') return value.text || '';
  return textFrom(value.content || value.delta || value.chunk);
}

lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    wire({ type: 'native_event', source: 'acp-server', data: { text: line } });
    return;
  }
  const thoughtDelta = message.method === 'session/delta' && message.params?.type === 'thought';
  wire(
    thoughtDelta
      ? { ...message, params: { ...message.params, delta: '[THOUGHT_REDACTED]' } }
      : message,
  );
  if (message.id !== undefined && (message.result !== undefined || message.error)) {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'ACP request failed'));
      else waiter.resolve(message.result);
    }
    return;
  }
  if (
    message.method === 'session/update' ||
    message.method === 'session/notification' ||
    message.method === 'session/delta'
  ) {
    if (thoughtDelta) return;
    finalText += textFrom(
      message.params?.update || message.params?.content || message.params?.delta || message.params,
    );
    return;
  }
  if (message.id !== undefined && message.method === 'session/request_permission') {
    const optionsList = message.params?.options || [];
    const approved = optionsList.find((item) => /allow|approve/i.test(item.kind || item.name || ''));
    const selected = approved || optionsList[0];
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: selected
        ? { outcome: { outcome: 'selected', optionId: selected.optionId || selected.id } }
        : { outcome: { outcome: 'cancelled' } },
    });
  }
});
server.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  await request('initialize', {
    protocolVersion: '1',
    clientInfo: { name: 'moss-eval', version: '0.1.0' },
    capabilities: {},
  });
  const session = await request('session/new', {
    cwd: options.cwd || process.cwd(),
    mcpServers: [],
  });
  await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: options.prompt,
  });
  wire({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: finalText.trim() || 'ACP turn completed',
  });
  server.stdin.end();
} catch (error) {
  wire({ type: 'result', subtype: 'error', is_error: true, result: error.message });
  server.kill();
  process.exitCode = 1;
}
