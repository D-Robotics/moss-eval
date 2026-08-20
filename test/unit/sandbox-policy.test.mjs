import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createAuthorizationRequest, grantAuthorization, authorizedSecretValues } from '../../src/core/authorization.mjs';
import { reconcileOwnedContainers, OWNER_LABEL } from '../../src/core/resource-ownership.mjs';
import {
  SandboxPolicyError,
  createSandboxPolicy,
  dockerPolicyArgs,
  validateEvaluatorMounts,
} from '../../src/core/sandbox-policy.mjs';
import { DockerRunner } from '../../src/runners/docker.mjs';

test('sandbox policy denies dangerous privileges and requires explicit network authorization', () => {
  assert.throws(
    () => createSandboxPolicy({ privileged: true }),
    (error) => error instanceof SandboxPolicyError && error.code === 'PROHIBITED_PRIVILEGE',
  );
  assert.throws(() => createSandboxPolicy({ docker_socket: true }), /Docker socket/);
  assert.throws(() => createSandboxPolicy({ host_mounts: ['C:/'] }), /host mounts/);
  assert.throws(
    () => createSandboxPolicy({ network: 'public' }),
    (error) => error.code === 'NETWORK_AUTHORIZATION_REQUIRED',
  );
  const policy = createSandboxPolicy({ network: 'disabled', cpu: 1, memory_mb: 512, pids: 32, disk_mb: 128, timeout_seconds: 10 });
  const args = dockerPolicyArgs(policy, { [OWNER_LABEL]: 'run-1' });
  assert.deepEqual(args.slice(0, 4), ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true']);
  assert.ok(args.includes('--network'));
  assert.ok(args.includes('--pids-limit'));
  assert.ok(args.includes('--storage-opt'));
  assert.ok(args.includes('--read-only'));
  assert.equal(args.includes('--privileged'), false);
});

test('network and named secret authorization stores names and fingerprints but no values', () => {
  const request = createAuthorizationRequest({
    operation: 'trial',
    targetFingerprint: 'a'.repeat(64),
    network: { mode: 'public', purpose: 'model API' },
    secretNames: ['MODEL_API_KEY'],
  });
  const authorization = grantAuthorization(request, {
    confirmed: true, approveNetwork: true, approvedSecretNames: ['MODEL_API_KEY'],
  });
  const values = authorizedSecretValues(authorization, {
    MODEL_API_KEY: 'super-secret-value', UNAPPROVED: 'not-shared',
  });
  assert.deepEqual(values, { MODEL_API_KEY: 'super-secret-value' });
  assert.doesNotMatch(JSON.stringify(request), /super-secret-value/);
  assert.doesNotMatch(JSON.stringify(authorization), /super-secret-value/);
  const policy = createSandboxPolicy({ network: 'public' }, authorization);
  assert.equal(policy.authorization_id, authorization.id);
});

test('mount validation rejects Docker sockets and writable trusted mounts', () => {
  assert.throws(() => validateEvaluatorMounts([{
    role: 'evaluator', source: path.resolve('docker.sock'), target: '/docker.sock', readOnly: true,
  }]), /Docker control sockets/);
  assert.throws(() => validateEvaluatorMounts([{
    role: 'task', source: path.resolve('task'), target: '/task', readOnly: false,
  }]), /must be read-only/);
});

test('Docker runner applies bounded policy and does not expose secret values in command arguments', async () => {
  const calls = [];
  const secret = 'secret-value-that-must-not-appear';
  const processRunner = async (spec) => {
    calls.push(spec);
    if (spec.args.includes('inspect')) {
      return { exitCode: 0, stdout: `sha256:${'1'.repeat(64)}\n`, stderr: '', startError: null, timedOut: false };
    }
    return {
      command: spec.command, args: spec.args, cwd: spec.cwd, exitCode: 137, signal: null,
      timedOut: true, aborted: false, startError: null, stdout: '', stderr: '', outputTruncated: false,
      startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 10_000,
    };
  };
  const runner = new DockerRunner({ process_runner: processRunner });
  const root = path.resolve('D:/fixture');
  const result = await runner.run({
    command: 'agent', args: [], input: null,
    env: { MODEL_API_KEY: secret, MODE: 'eval' },
    metadata: { secret_env_names: ['MODEL_API_KEY'] },
  }, {
    task: {
      id: 'task', replicate: 1,
      environment: {
        image: 'fixture:latest', network: 'disabled', cpu: 1, memory_mb: 512,
        pids: 32, disk_mb: 128, read_only_root: true,
      },
    },
    replicate: 1,
    workspace: path.join(root, 'workspace'), taskDir: path.join(root, 'task'),
    trialDir: path.join(root, 'run/trial'), runDir: path.join(root, 'run'), evalRoot: root,
    timeoutMs: 10_000,
  });
  const runCall = calls.find((call) => call.args.includes('run'));
  assert.ok(runCall.args.includes('--pids-limit'));
  assert.ok(runCall.args.includes('--storage-opt'));
  assert.ok(runCall.args.includes(`${OWNER_LABEL}=run`));
  assert.ok(runCall.args.includes('MODEL_API_KEY'));
  assert.doesNotMatch(JSON.stringify(runCall.args), new RegExp(secret));
  assert.equal(runCall.env.MODEL_API_KEY, secret);
  assert.deepEqual(result.budgetBreach, { type: 'wall_time', limit_seconds: 10 });
});

test('resource reconciliation targets only evaluator-labeled containers', async () => {
  const calls = [];
  const processRunner = async (spec) => {
    calls.push(spec);
    return {
      exitCode: 0, startError: null, timedOut: false,
      stdout: spec.args.includes('ps') ? 'container-a\ncontainer-b\n' : '', stderr: '',
    };
  };
  const dryRun = await reconcileOwnedContainers({ owner: 'run-1', processRunner });
  assert.deepEqual(dryRun.containers, ['container-a', 'container-b']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes(`label=${OWNER_LABEL}=run-1`));
  const removed = await reconcileOwnedContainers({ owner: 'run-1', processRunner, dryRun: false });
  assert.deepEqual(removed.removed, ['container-a', 'container-b']);
  assert.deepEqual(calls.at(-1).args.slice(-2), ['container-a', 'container-b']);
});
