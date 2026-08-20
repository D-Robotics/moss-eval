import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../../src/lib/process.mjs';

test('runProcess cooperatively cancels and force-cleans its owned process tree', async () => {
  const controller = new AbortController();
  const pending = runProcess({
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.ok(result.durationMs < 10_000);
});

test('runProcess refuses an already-cancelled operation before spawning', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runProcess({ command: process.execPath, args: ['-e', 'process.exit(0)'], signal: controller.signal }),
    (error) => error.code === 'ABORT_ERR',
  );
});
