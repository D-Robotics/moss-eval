import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../src/core/config.mjs';
import { loadTasks, selectTasks } from '../../src/core/task-loader.mjs';
import { evaluate } from '../../src/core/evaluator.mjs';
import { aggregateRun } from '../../src/core/aggregate.mjs';
import { runProcess } from '../../src/lib/process.mjs';
import { PtyRunner } from '../../src/runners/pty.mjs';
import { calibrateTasks } from '../../src/core/calibration.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('mock agent completes the end-to-end evaluation pipeline', async () => {
  const config = await loadConfig(path.join(root, 'configs/mock.example.json'));
  config.agents.mock.command = process.execPath;
  const tasks = selectTasks(await loadTasks(config.task_roots), { ids: ['smoke-create-file', 'smoke-safety'] });
  const run = await evaluate({
    tasks, agentNames: ['mock'], config, label: 'node-test', trialsOverride: 1, allowLocal: true,
  });
  assert.equal(run.trials.length, 2);
  assert.ok(run.trials.every((trial) => trial.success));
  for (const trial of run.trials) {
    assert.equal(trial.metrics.native_telemetry_available, false);
    assert.equal(trial.metrics.telemetry_valid, null);
    await fsp.access(trial.artifacts.native_telemetry);
    await fsp.access(trial.artifacts.telemetry_summary);
    await fsp.access(trial.artifacts.telemetry_mismatches);
  }
  const summary = await aggregateRun(run.runDir, { k: 1 });
  assert.equal(summary.agents[0].pass_at_1.value, 1);
  assert.equal(summary.agents[0].pass_pow_k.value, 1);
  assert.equal(summary.agents[0].telemetry.native_available_rate.value, 0);
});

test('ACP driver completes initialize, session/new, and session/prompt', async () => {
  const result = await runProcess({
    command: process.execPath,
    args: [
      path.join(root, 'drivers/acp-client.mjs'), '--server', process.execPath,
      '--server-args', JSON.stringify([path.join(root, 'examples/mock-acp-server.mjs')]),
      '--cwd', root, '--prompt', 'hello',
    ],
    cwd: root,
    timeoutMs: 10000,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /ACP says hello/);
  assert.match(result.stdout, /"subtype":"success"/);
  assert.doesNotMatch(result.stdout, /private reasoning/);
  assert.match(result.stdout, /THOUGHT_REDACTED/);
});

test('PTY runner captures terminal output', async () => {
  const runner = new PtyRunner();
  const result = await runner.run({
    command: process.execPath,
    args: ['-e', 'process.stdout.write("pty-ok")'],
    env: {},
  }, {
    workspace: root,
    timeoutMs: 10000,
    onStdout: null,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /pty-ok/);
});

test('dataset calibration accepts a reference and rejects all negative controls', async () => {
  const config = await loadConfig(path.join(root, 'configs/moss.example.json'));
  const tasks = selectTasks(await loadTasks(config.task_roots), { ids: ['code-003'] });
  const result = await calibrateTasks(tasks, {
    outputRoot: path.join(config.output_root, '..', 'test-calibration'),
    concurrency: 2,
  });
  assert.equal(result.report.gate, 'pass');
  assert.equal(result.report.control_count, 4);
  assert.equal(result.report.reference_false_negative_rate, 0);
  assert.equal(result.report.negative_false_positive_rate, 0);
});
