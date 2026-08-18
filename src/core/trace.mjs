import fsp from 'node:fs/promises';
import path from 'node:path';
import { redactObject } from '../lib/json.mjs';

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.delta === 'string') return content.delta;
    return textFromContent(content.content || content.chunk || content.message);
  }
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text || '')
    .join('\n');
}

function normalizeUsage(usage = {}) {
  const input = usage.input_tokens ?? usage.inputTokens ?? 0;
  const output = usage.output_tokens ?? usage.outputTokens ?? 0;
  const total = usage.total_tokens ?? usage.totalTokens ?? (input + output || null);
  return {
    input_tokens: input || 0,
    output_tokens: output || 0,
    total_tokens: total,
    cache_read_tokens: usage.cache_read_tokens ?? usage.cacheReadTokens ?? null,
    cache_creation_tokens:
      usage.cache_creation_tokens ?? usage.cacheCreationTokens ?? null,
  };
}

export class TraceCollector {
  constructor(options = {}) {
    this.events = [];
    this.sequence = 0;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.stdoutRaw = '';
    this.stderrRaw = '';
    this.secrets = options.secrets || [];
    this.toolCalls = new Map();
    this.finalResponse = '';
    this.usage = {};
    this.costUsd = null;
    this.terminal = null;
  }

  record(type, source, data = {}) {
    const event = redactObject(
      {
        schema_version: '1.0',
        sequence: ++this.sequence,
        timestamp: new Date().toISOString(),
        type,
        source,
        data,
      },
      this.secrets,
    );
    this.events.push(event);
    return event;
  }

  ingestStdout(chunk) {
    const text = chunk.toString('utf8');
    this.stdoutRaw += text;
    this.stdoutBuffer += text;
    this.consumeLines(false);
  }

  ingestStderr(chunk) {
    const text = chunk.toString('utf8');
    this.stderrRaw += text;
    this.stderrBuffer += text;
    this.consumeLines(true);
  }

  consumeLines(isError) {
    const key = isError ? 'stderrBuffer' : 'stdoutBuffer';
    const lines = this[key].split(/\r?\n/);
    this[key] = lines.pop() || '';
    for (const line of lines) this.ingestLine(line, isError);
  }

  ingestLine(line, isError = false) {
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.record(isError ? 'stderr' : 'stdout', 'process', { text: line });
      return;
    }
    this.normalize(parsed);
  }

  normalize(event) {
    if (!event || typeof event !== 'object') return;
    if (event.jsonrpc === '2.0') {
      if (event.method === 'session/request_permission') {
        this.record('approval_request', 'acp', event.params || {});
        return;
      }
      if (event.method === 'session/toolCall') {
        const update = event.params || {};
        const callId = update.toolCallId || update.callId || update.id;
        if (update.state === 'start') {
          const call = {
            call_id: callId || 'call-' + (this.toolCalls.size + 1),
            tool: update.name || update.title || 'unknown',
            arguments: update.input || update.arguments || {},
            status: 'requested',
          };
          this.toolCalls.set(call.call_id, call);
          this.record('tool_call', 'acp', call);
        } else {
          const call = this.toolCalls.get(callId);
          const status = update.isError ? 'error' : 'success';
          if (call) {
            call.status = status;
            call.result = update.result;
          }
          this.record('tool_result', 'acp', {
            call_id: callId,
            status,
            result: update.result || null,
          });
        }
        return;
      }
      if (
        event.method === 'session/update' ||
        event.method === 'session/notification' ||
        event.method === 'session/delta'
      ) {
        const update = event.params?.update || event.params || {};
        if (event.method === 'session/delta' && update.type === 'thought') {
          this.record('native_event', 'acp', {
            event: {
              jsonrpc: event.jsonrpc,
              method: event.method,
              params: { ...update, delta: '[THOUGHT_REDACTED]' },
            },
          });
          return;
        }
        const kind = update.sessionUpdate || update.type || update.kind || 'session_update';
        const text = textFromContent(update.content || update.message || update.delta || update.chunk);
        if (
          (/agent.*message|message.*chunk|text.*delta/i.test(kind) || event.method === 'session/delta') &&
          text
        ) {
          this.finalResponse += text;
          this.record('assistant_message', 'acp', { text, kind });
          return;
        }
        if (/tool.*call/i.test(kind) && !/update|result/i.test(kind)) {
          const call = {
            call_id: update.toolCallId || update.callId || update.id || 'call-' + (this.toolCalls.size + 1),
            tool: update.title || update.name || update.tool || 'unknown',
            arguments: update.input || update.arguments || {},
            status: 'requested',
          };
          this.toolCalls.set(call.call_id, call);
          this.record('tool_call', 'acp', call);
          return;
        }
        if (/tool.*(?:update|result)/i.test(kind)) {
          const callId = update.toolCallId || update.callId || update.id;
          const call = this.toolCalls.get(callId);
          const status = /fail|error/i.test(update.status || '') ? 'error' : 'success';
          if (call) call.status = status;
          this.record('tool_result', 'acp', { call_id: callId, status, result: update.content || update.output || null });
          return;
        }
      }
      this.record('native_event', 'acp', { event });
      return;
    }
    if (event.type === 'assistant' && event.message) {
      const content = event.message.content;
      const text = textFromContent(content);
      if (text) {
        this.finalResponse += (this.finalResponse ? '\n' : '') + text;
        this.record('assistant_message', 'agent', { text });
      }
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item?.type !== 'tool_use') continue;
          const call = {
            call_id: item.id || 'call-' + (this.toolCalls.size + 1),
            tool: item.name,
            arguments: item.input || {},
            status: 'requested',
          };
          this.toolCalls.set(call.call_id, call);
          this.record('tool_call', 'agent', call);
        }
      }
      return;
    }

    if (event.type === 'user' && event.message?.content) {
      for (const item of event.message.content) {
        if (item?.type !== 'tool_result') continue;
        const call = this.toolCalls.get(item.tool_use_id);
        if (call) {
          call.status = item.is_error ? 'error' : 'success';
          call.result = item.content;
          call.outcome = item.outcome ?? null;
          call.duration_ms = item.durationMs ?? item.duration_ms ?? null;
          call.aborted = item.aborted ?? null;
          call.error = item.error ?? null;
        }
        this.record('tool_result', 'tool', {
          call_id: item.tool_use_id,
          tool: item.name || call?.tool || null,
          status: item.is_error ? 'error' : 'success',
          result: item.content,
          outcome: item.outcome ?? null,
          duration_ms: item.durationMs ?? item.duration_ms ?? null,
          aborted: item.aborted ?? null,
          error: item.error ?? null,
        });
      }
      return;
    }

    if (event.type === 'llm_usage') {
      const usage = normalizeUsage(event);
      const current = this.usage || {};
      this.usage = {
        input_tokens: (current.input_tokens || 0) + usage.input_tokens,
        output_tokens: (current.output_tokens || 0) + usage.output_tokens,
        total_tokens: (current.total_tokens || 0) + (usage.total_tokens || 0),
        cache_read_tokens:
          (current.cache_read_tokens || 0) + (usage.cache_read_tokens || 0),
        cache_creation_tokens:
          (current.cache_creation_tokens || 0) + (usage.cache_creation_tokens || 0),
      };
      this.record('llm_usage', 'agent', { usage });
      return;
    }

    if (event.type === 'result') {
      this.costUsd = event.total_cost_usd ?? event.cost_usd ?? this.costUsd;
      this.usage = event.usage ? normalizeUsage(event.usage) : this.usage;
      this.terminal = {
        subtype: event.subtype || null,
        stop_reason: event.stop_reason || null,
        is_error: Boolean(event.is_error),
        turns: event.num_turns ?? null,
      };
      if (typeof event.result === 'string' && event.result) this.finalResponse = event.result;
      this.record('agent_result', 'agent', {
        terminal: this.terminal,
        usage: this.usage,
        cost_usd: this.costUsd,
      });
      return;
    }

    const knownTypes = new Set([
      'approval_request',
      'approval_decision',
      'hook_decision',
      'context_compaction',
      'goal',
      'checkpoint',
      'resume',
      'steering',
      'cancellation',
      'subagent_spawn',
      'subagent_result',
      'subagent_failure',
      'subagent_stop',
      'provider_error',
      'retry',
      'resource_snapshot',
    ]);
    if (knownTypes.has(event.type)) {
      this.record(event.type, event.source || 'agent', event.data || event);
      return;
    }

    if (event.type === 'system' && event.subtype === 'thinking_tokens') return;
    this.record('native_event', 'agent', { event });
  }

  finish() {
    if (this.stdoutBuffer) this.ingestLine(this.stdoutBuffer, false);
    if (this.stderrBuffer) this.ingestLine(this.stderrBuffer, true);
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }

  summary() {
    const calls = [...this.toolCalls.values()];
    const eventCounts = {};
    for (const event of this.events) eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    return {
      event_counts: eventCounts,
      tool_calls: calls,
      tool_call_count: calls.length,
      tool_error_count: calls.filter((call) => call.status === 'error').length,
      retries: eventCounts.retry || 0,
      context_compactions: eventCounts.context_compaction || 0,
      subagent_spawns: eventCounts.subagent_spawn || 0,
      final_response: redactObject(this.finalResponse, this.secrets),
      usage: this.usage,
      cost_usd: this.costUsd,
      terminal: this.terminal,
    };
  }

  async write(directory) {
    this.finish();
    await fsp.mkdir(directory, { recursive: true });
    const trace = this.events.map((event) => JSON.stringify(event)).join('\n');
    await Promise.all([
      fsp.writeFile(path.join(directory, 'trajectory.jsonl'), trace + (trace ? '\n' : ''), 'utf8'),
      fsp.writeFile(
        path.join(directory, 'stdout.log'),
        redactObject(this.stdoutRaw, this.secrets),
        'utf8',
      ),
      fsp.writeFile(
        path.join(directory, 'stderr.log'),
        redactObject(this.stderrRaw, this.secrets),
        'utf8',
      ),
      fsp.writeFile(
        path.join(directory, 'final-response.txt'),
        redactObject(this.finalResponse, this.secrets),
        'utf8',
      ),
    ]);
  }
}
