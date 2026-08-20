import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/core/config.mjs';
import { evaluate, runTrial } from '../../src/core/evaluator.mjs';
import { loadTasks, selectTasks } from '../../src/core/task-loader.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('unexpected trial exceptions are persisted and isolated from independent trials', async (t) => {
  const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-isolation-'));
  t.after(() => fsp.rm(outputRoot, { recursive: true, force: true }));
  const config = await loadConfig(path.join(root, 'configs/mock.example.json'));
  config.output_root = outputRoot;
  config.agents.mock.command = process.execPath;
  const tasks = selectTasks(await loadTasks(config.task_roots), {
    ids: ['smoke-create-file', 'smoke-safety'],
  });

  const result = await evaluate({
    tasks,
    agentNames: ['mock'],
    config,
    label: 'isolation',
    trialsOverride: 1,
    concurrency: 2,
    allowLocal: true,
    trialExecutor: async (options) => {
      if (options.task.id === 'smoke-create-file') {
        const error = new Error('synthetic grader crash');
        error.code = 'SYNTHETIC_CRASH';
        error.stage = 'grader';
        throw error;
      }
      return runTrial(options);
    },
  });

  assert.equal(result.metadata.status, 'completed');
  assert.equal(result.trials.length, 2);
  const isolated = result.trials.find((trial) => trial.task.id === 'smoke-create-file');
  const independent = result.trials.find((trial) => trial.task.id === 'smoke-safety');
  assert.equal(isolated.status, 'invalid');
  assert.equal(isolated.failure_category, 'infrastructure_error');
  assert.equal(independent.success, true);
  const persisted = JSON.parse(await fsp.readFile(
    path.join(result.runDir, 'trials/smoke-create-file/mock/trial-1/trial.json'),
    'utf8',
  ));
  assert.equal(persisted.graders[0].details.stage, 'grader');
});

test('trial boundary redacts configured secrets from returned UI projections and artifacts', async (t) => {
  const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-redaction-'));
  t.after(() => fsp.rm(outputRoot, { recursive: true, force: true }));
  const variable = 'MOSS_EVAL_TEST_SECRET';
  const previous = process.env[variable];
  const secret = 'do-not-leak-this-value';
  process.env[variable] = secret;
  t.after(() => {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  });
  const config = await loadConfig(path.join(root, 'configs/mock.example.json'));
  config.output_root = outputRoot;
  config.agents.mock.secret_env = [variable];
  const tasks = selectTasks(await loadTasks(config.task_roots), { ids: ['smoke-create-file'] });
  const result = await evaluate({
    tasks, agentNames: ['mock'], config, allowLocal: true,
    trialExecutor: async () => { throw new Error(`provider returned ${secret}`); },
  });
  assert.doesNotMatch(JSON.stringify(result.trials), new RegExp(secret));
  assert.match(result.trials[0].graders[0].reason, /\[REDACTED\]/);
  assert.doesNotMatch(await fsp.readFile(path.join(
    result.runDir, 'trials/smoke-create-file/mock/trial-1/trial.json',
  ), 'utf8'), new RegExp(secret));
});

test('pre-cancelled evaluations persist every pending trial as cancelled without starting workers', async (t) => {
  const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-cancelled-'));
  t.after(() => fsp.rm(outputRoot, { recursive: true, force: true }));
  const config = await loadConfig(path.join(root, 'configs/mock.example.json'));
  config.output_root = outputRoot;
  const tasks = selectTasks(await loadTasks(config.task_roots), {
    ids: ['smoke-create-file', 'smoke-safety'],
  });
  const controller = new AbortController();
  controller.abort();
  let starts = 0;
  const result = await evaluate({
    tasks, agentNames: ['mock'], config, signal: controller.signal,
    trialsOverride: 1,
    trialExecutor: async () => { starts += 1; throw new Error('must not start'); },
  });
  assert.equal(starts, 0);
  assert.equal(result.metadata.status, 'cancelled');
  assert.equal(result.trials.length, 2);
  assert.ok(result.trials.every((trial) => trial.status === 'cancelled'));
});
