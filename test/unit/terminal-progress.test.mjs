import test from 'node:test';
import assert from 'node:assert/strict';

import { TerminalProgress } from '../../src/cli/terminal-progress.mjs';

function fakeStream(isTTY = false) {
  return {
    isTTY,
    columns: 120,
    output: '',
    write(value) { this.output += value; },
  };
}

test('plain terminal progress reports starts, completion counts, and failure reason', () => {
  const stream = fakeStream();
  const progress = new TerminalProgress({ stream, mode: 'plain', now: () => 1000 });
  progress.onRunStart({ run_id: 'run-1', trial_count: 2, run_directory: 'artifacts/run-1' });
  const unit = { task: { id: 'code-001' }, agentName: 'moss', replicate: 1 };
  progress.onTrialStart(unit);
  progress.onTrialComplete({
    task: { id: 'code-001' }, agent: 'moss', replicate: 1, status: 'failed',
    failure_category: 'budget_exceeded', metrics: { duration_ms: 2500 },
  }, 1, 2);

  assert.match(stream.output, /\[start\] code-001 moss #1/);
  assert.match(stream.output, /\[1\/2\].*failed 3s reason=budget_exceeded/);
});

test('dashboard terminal progress includes active and recent trials', () => {
  const stream = fakeStream(true);
  let now = 1000;
  const progress = new TerminalProgress({ stream, mode: 'dashboard', now: () => now });
  progress.onRunStart({ run_id: 'run-1', trial_count: 1, run_directory: 'artifacts/run-1' });
  progress.onTrialStart({ task: { id: 'web-001' }, agentName: 'moss', replicate: 1 });
  now = 4000;
  assert.match(progress.lines().join('\n'), /web-001 moss #1  00:03/);
  progress.onTrialComplete({
    task: { id: 'web-001' }, agent: 'moss', replicate: 1, status: 'passed',
    failure_category: null, metrics: { duration_ms: 3000 },
  }, 1, 1);
  assert.match(progress.lines().join('\n'), /PASS  web-001 moss #1/);
  progress.finish();
});
