import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectMossNativeTelemetry,
  mergeTraceWithNative,
  reconcileNativeTelemetry,
  scoreToolExpectations,
} from '../../src/core/native-telemetry.mjs';

async function workspaceFixture() {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-native-telemetry-'));
  const sessionDir = path.join(workspace, '.moss', 'sessions');
  await fsp.mkdir(sessionDir, { recursive: true });
  const state = {
    type: 'state_replace',
    messages: [
      { role: 'assistant', thinking: ['private chain canary-secret'], content: [
        { type: 'text', text: 'message text must not be exported' },
        { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a', token: 'canary-secret' } },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'call-1', name: 'read_file', content: 'safe canary-secret', is_error: false, outcome: 'ok', durationMs: 12 },
      ] },
    ],
  };
  const appended = {
    type: 'message',
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'call-2', name: 'run_tests', input: { file: 'test/a.test.mjs' } },
    ] },
  };
  await fsp.writeFile(
    path.join(sessionDir, 'cli-test.jsonl'),
    JSON.stringify(state) + '\n' + JSON.stringify(appended) + '\n',
  );
  const usage = Array.from({ length: 11 }, (_, index) => ({
    runId: 'run-1', providerId: 'provider', model: 'Moss',
    inputTokens: index === 0 ? 149257 : 1,
    outputTokens: index === 0 ? 4011 : 1,
    cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 5, success: true,
  }));
  await fsp.writeFile(
    path.join(workspace, '.moss', 'llm-usage.jsonl'),
    usage.map((record) => JSON.stringify(record)).join('\n') + '\n',
  );
  return workspace;
}

test('native telemetry extracts tools and usage without exporting thoughts or secrets', async (t) => {
  const workspace = await workspaceFixture();
  t.after(() => fsp.rm(workspace, { recursive: true, force: true }));
  const native = await collectMossNativeTelemetry(workspace, { secrets: ['canary-secret'] });
  assert.equal(native.session.tool_call_count, 2);
  assert.equal(native.session.tool_result_count, 1);
  assert.equal(native.session.tool_calls[0].duration_ms, 12);
  assert.equal(native.usage.model_call_count, 11);
  assert.equal(native.usage.total_tokens, 153288);
  const serialized = JSON.stringify(native);
  assert.doesNotMatch(serialized, /private chain|message text must not be exported|canary-secret/);
  assert.match(serialized, /REDACTED/);
});

test('native telemetry gracefully reports unavailable files', async (t) => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-native-empty-'));
  t.after(() => fsp.rm(workspace, { recursive: true, force: true }));
  const native = await collectMossNativeTelemetry(workspace);
  assert.equal(native.available, false);
  assert.equal(native.session.available, false);
  assert.equal(native.usage.model_call_count, null);
});

test('reconciliation detects structured trace mismatch but permits one-shot native enrichment', async (t) => {
  const workspace = await workspaceFixture();
  t.after(() => fsp.rm(workspace, { recursive: true, force: true }));
  const native = await collectMossNativeTelemetry(workspace);
  const stream = {
    tool_calls: [{ call_id: 'call-1', tool: 'read_file', arguments: {}, status: 'success' }],
    usage: { total_tokens: 153288 },
    event_counts: { assistant_message: 9 },
  };
  const mismatch = reconcileNativeTelemetry(stream, native, { mode: 'stream-json' });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.mismatches.some((item) => item.type === 'stream_session_tool_count'));

  const oneShot = reconcileNativeTelemetry({ ...stream, tool_calls: [] }, native, { mode: 'one-shot' });
  assert.equal(oneShot.valid, true);
  const merged = mergeTraceWithNative(stream, native, mismatch);
  assert.equal(merged.model_call_count, 11);
  assert.equal(merged.tool_call_count, 2);
});

test('tool expectations produce nullable or oracle-backed quality metrics', () => {
  assert.equal(scoreToolExpectations([], null).f1, null);
  const score = scoreToolExpectations([
    { tool: 'edit_file' },
    { tool: 'run_tests' },
    { tool: 'read_file' },
  ], {
    expected: ['edit_file', 'run_tests'],
    required_all: ['edit_file'],
    forbidden: ['write_file'],
    max_calls: 4,
    must_verify_after_mutation: true,
  });
  assert.equal(score.eligible, true);
  assert.equal(score.recall, 1);
  assert.equal(score.precision, 2 / 3);
  assert.equal(score.policy_passed, true);
});
