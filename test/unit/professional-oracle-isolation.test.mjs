import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { DockerRunner, dockerMountPlan } from '../../src/runners/docker.mjs';
import { runCommandVerifier } from '../../src/verifiers/command.mjs';

function context(phase) {
  const root = path.resolve('isolation-fixture');
  return {
    phase,
    task: { id: 'professional-task', oracle_isolation: 'evaluator-only', environment: {} },
    replicate: 1,
    workspace: path.join(root, 'workspace'),
    trialDir: path.join(root, 'trial'),
    taskDir: path.join(root, 'task'),
    evalRoot: path.join(root, 'eval'),
    oracleRoot: path.join(root, 'oracle'),
  };
}

test('Agent mount plan excludes task evaluator and Oracle roots', () => {
  const mounts = dockerMountPlan(context('agent'));
  assert.deepEqual(mounts.map((mount) => mount.role), ['workspace', 'trial']);
});

test('grader mount plan adds trusted roots read-only in a fresh phase', () => {
  const mounts = dockerMountPlan(context('grader'));
  assert.deepEqual(mounts.map((mount) => mount.role), ['workspace', 'trial', 'task', 'evaluator', 'oracle']);
  assert.ok(mounts.filter((mount) => ['task', 'evaluator', 'oracle'].includes(mount.role)).every((mount) => mount.readOnly));
});

test('Docker Agent arguments contain no task evaluator or Oracle volume', async () => {
  const calls = [];
  const runner = new DockerRunner({
    process_runner: async (request) => {
      calls.push(request);
      if (request.args[0] === 'image') return { exitCode: 0, stdout: 'sha256:test\n', stderr: '', timedOut: false };
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    },
  });
  const item = context('agent');
  item.runDir = path.dirname(item.trialDir);
  item.timeoutMs = 1000;
  item.task.environment = { image: 'moss:test', network: 'disabled' };
  const result = await runner.run({ command: 'moss', args: [], env: {} }, item);
  const runArgs = calls.find((call) => call.args[0] === 'run').args;
  const volumes = runArgs.flatMap((arg, index) => arg === '--volume' ? [runArgs[index + 1]] : []);
  assert.ok(volumes.some((volume) => volume.endsWith(':/workspace')));
  assert.ok(volumes.some((volume) => volume.endsWith(':/run')));
  assert.ok(volumes.every((volume) => !volume.includes(':/task') && !volume.includes(':/eval') && !volume.includes(':/oracle')));
  assert.deepEqual(result.mountPolicy.mounts.map((mount) => mount.role), ['workspace', 'trial']);
});

test('command verifier requests the grader phase and persists mount evidence', async () => {
  let observedPhase = null;
  const result = await runCommandVerifier({
    id: 'oracle', type: 'command', version: '1', required: true, timeout_seconds: 5,
    command: ['node', 'verify.mjs'], expect: { exit_codes: [0] },
  }, {
    paths: { workspace: '/workspace', task: '/task', run: '/run', trial: '/run' },
    task: { id: 'professional-task' }, replicate: 1, runnerContext: {},
    runner: { run: async (_command, runnerContext) => {
      observedPhase = runnerContext.phase;
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, startError: null, mountPolicy: { phase: 'grader', mounts: [] } };
    } },
  });
  assert.equal(observedPhase, 'grader');
  assert.equal(result.status, 'passed');
  assert.equal(result.details.mount_policy.phase, 'grader');
});
