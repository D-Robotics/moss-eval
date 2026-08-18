#!/usr/bin/env node
import readline from 'node:readline';

const lines = readline.createInterface({ input: process.stdin });
function send(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1', capabilities: {} } });
  } else if (message.method === 'session/new') {
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'mock-session' } });
  } else if (message.method === 'session/prompt') {
    send({
      jsonrpc: '2.0', method: 'session/delta',
      params: { sessionId: 'mock-session', type: 'thought', delta: 'private reasoning' },
    });
    send({
      jsonrpc: '2.0', method: 'session/toolCall',
      params: { sessionId: 'mock-session', toolCallId: 'mock-call', name: 'read_file', input: { path: 'x' }, state: 'start' },
    });
    send({
      jsonrpc: '2.0', method: 'session/toolCall',
      params: { sessionId: 'mock-session', toolCallId: 'mock-call', name: 'read_file', state: 'end', result: 'ok', isError: false },
    });
    send({
      jsonrpc: '2.0', method: 'session/update',
      params: { sessionId: 'mock-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP says hello' } } },
    });
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
  }
});
