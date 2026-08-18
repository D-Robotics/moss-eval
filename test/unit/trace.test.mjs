import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceCollector } from '../../src/core/trace.mjs';

test('trace normalizes tool calls and redacts configured secrets', () => {
  const trace = new TraceCollector({ secrets: ['canary-secret'] });
  trace.ingestStdout(Buffer.from(JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'text', text: 'safe canary-secret' },
    { type: 'tool_use', id: '1', name: 'read_file', input: { path: 'a' } },
  ] } }) + '\n'));
  trace.finish();
  const summary = trace.summary();
  assert.equal(summary.tool_call_count, 1);
  assert.doesNotMatch(JSON.stringify(trace.events), /canary-secret/);
});

test('ACP trace redacts thought deltas and normalizes tool lifecycle', () => {
  const trace = new TraceCollector();
  trace.normalize({ jsonrpc: '2.0', method: 'session/delta', params: { type: 'thought', delta: 'private chain' } });
  trace.normalize({ jsonrpc: '2.0', method: 'session/toolCall', params: {
    toolCallId: 'c1', name: 'read_file', input: { path: 'a' }, state: 'start',
  } });
  trace.normalize({ jsonrpc: '2.0', method: 'session/toolCall', params: {
    toolCallId: 'c1', name: 'read_file', state: 'end', result: 'ok', isError: false,
  } });
  const serialized = JSON.stringify(trace.events);
  assert.doesNotMatch(serialized, /private chain/);
  assert.match(serialized, /THOUGHT_REDACTED/);
  assert.equal(trace.summary().tool_call_count, 1);
  assert.equal(trace.summary().tool_calls[0].status, 'success');
});

test('trace normalizes camelCase MOSS token usage', () => {
  const trace = new TraceCollector();
  trace.normalize({
    type: 'result',
    result: 'done',
    usage: { inputTokens: 64011, outputTokens: 951 },
  });
  assert.deepEqual(trace.summary().usage, {
    input_tokens: 64011,
    output_tokens: 951,
    total_tokens: 64962,
    cache_read_tokens: null,
    cache_creation_tokens: null,
  });
});

test('trace counts per-request MOSS usage events before the terminal aggregate', () => {
  const trace = new TraceCollector();
  trace.normalize({ type: 'llm_usage', input_tokens: 10, output_tokens: 2 });
  trace.normalize({ type: 'llm_usage', input_tokens: 20, output_tokens: 3 });
  const summary = trace.summary();
  assert.equal(summary.event_counts.llm_usage, 2);
  assert.equal(summary.usage.total_tokens, 35);
});
