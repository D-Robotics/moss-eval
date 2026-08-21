import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAdapter } from '../../src/adapters/index.mjs';
import { unavailableNativeTelemetry } from '../../src/core/native-telemetry.mjs';
import { TargetAdapterRegistry } from '../../src/targets/adapter-registry.mjs';
import { createBuiltInTargetRegistry } from '../../src/targets/index.mjs';
import {
  createPreparedLaunch,
  createPreparedTargetManifest,
  loadPreparedTarget,
  savePreparedTarget,
} from '../../src/targets/prepared-target.mjs';

function sourceRecord(fingerprint = 'a'.repeat(64)) {
  return {
    id: `source-${fingerprint.slice(0, 8)}`,
    snapshot_fingerprint: fingerprint,
    revision: null,
    canonical_location: 'D:/fixture',
  };
}

function manifest() {
  return {
    schema_version: '1.0',
    adapter: { id: 'manifest-command', api_version: '1.0' },
    runtime: 'node',
    preparation: { working_directory: '.', steps: [{ command: 'npm', args: ['ci'], network: true }] },
    launch: { command: 'bin/agent.mjs', args: ['--json'], protocol: 'stream-json', working_directory: '.' },
    capabilities: { modes: ['stream-json'], telemetry_level: 'L1', tools: ['read_file'], tags: ['coding-repository'] },
    environment: { required: [], optional: [], secrets: [] },
    network: { preparation_required: true, runtime_required: false, allowed_hosts: ['registry.npmjs.org'] },
    sandbox: { privileged: false, docker_socket: false, host_mounts: [] },
  };
}

const sandboxPolicy = {
  version: '1.0', network: 'disabled', privileged: false, docker_socket: false,
  cpu: 2, memory_mb: 2048, pids: 256, timeout_seconds: 600,
};

const imageDigest = `sha256:${'1'.repeat(64)}`;

test('target registry enforces a trusted versioned conformance contract', () => {
  const registry = createBuiltInTargetRegistry();
  assert.deepEqual(registry.describe().map((item) => item.id), ['moss', 'manifest-command']);
  assert.equal(registry.get('moss').apiVersion, '1.0');
  assert.throws(() => registry.get('unknown'), /not installed/);
  assert.throws(
    () => new TargetAdapterRegistry().register({ id: 'broken', version: '1', apiVersion: '1.0' }),
    /missing isCompatible/,
  );
  assert.throws(
    () => new TargetAdapterRegistry().register({ id: 'future', version: '1', apiVersion: '2.0' }),
    /incompatible/,
  );
});

test('manifest adapter returns declarative plans without importing or executing repository code', async () => {
  const adapter = createBuiltInTargetRegistry().get('manifest-command');
  const configuration = manifest();
  const plan = adapter.createPreparationPlan({ sourceRecord: sourceRecord(), manifest: configuration });
  assert.deepEqual(plan.steps, configuration.preparation.steps);
  assert.equal(plan.output.command, 'bin/agent.mjs');
  const telemetry = await adapter.collectTelemetry();
  assert.deepEqual(telemetry, unavailableNativeTelemetry('manifest-adapter'));
});

test('MOSS built-in target adapter preserves mode and telemetry behavior from the CLI adapter', async () => {
  const task = {
    id: 'fixture', instruction: 'do work', mode: 'stream-json',
    environment: { env: {} },
  };
  const cliAdapter = createAdapter('moss', {
    adapter: 'moss', command: 'moss', args: ['{instruction}'], _config_directory: '.',
  });
  const cliLaunch = cliAdapter.build(task, {
    paths: { workspace: '/workspace', task: '/task', run: '/run', trial: '/trial', eval: '/eval' },
    replicate: 1,
    faultEnvironment: {},
  });
  const targetAdapter = createBuiltInTargetRegistry().get('moss');
  const preparedTarget = createPreparedTargetManifest({
    sourceRecord: sourceRecord(), adapter: targetAdapter, effectiveConfiguration: {},
    preparationPlan: targetAdapter.createPreparationPlan({ sourceRecord: sourceRecord() }),
    sandboxPolicy, runtime: { node: '22.16.0' }, imageDigest,
    capabilities: targetAdapter.describeCapabilities(),
  });
  const targetLaunch = createPreparedLaunch(targetAdapter, {
    preparedTarget, mode: 'stream-json', args: ['do work'],
  });
  assert.equal(cliLaunch.env.MOSS_EVAL_RUNTIME_MODE, targetLaunch.env.MOSS_EVAL_RUNTIME_MODE);
  assert.equal(targetLaunch.protocol, 'stream-json');
  assert.equal(targetLaunch.image, imageDigest);
  assert.equal(targetAdapter.describeCapabilities().telemetry_level, 'L3');
});

test('MOSS adapter marks a missing model configuration as an invalid runtime precondition', () => {
  const adapter = createAdapter('moss', {
    adapter: 'moss',
    command: 'moss',
    args: ['{instruction}'],
  });

  assert.deepEqual(adapter.diagnoseProcess({
    exitCode: 3,
    stderr: '[moss] No model configured yet.\nMoss needs a model configuration before it can run.',
  }), {
    invalid: true,
    category: 'configuration_error',
    code: 'MOSS_MODEL_NOT_CONFIGURED',
    message: 'MOSS requires a model configuration before evaluation can start.',
  });
  assert.equal(adapter.diagnoseProcess({ exitCode: 0, stderr: '' }), null);
});

test('prepared targets use deterministic fingerprints, immutable digests, cache reuse, and invalidation', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-targets-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const adapter = createBuiltInTargetRegistry().get('manifest-command');
  const configuration = manifest();
  const plan = adapter.createPreparationPlan({ sourceRecord: sourceRecord(), manifest: configuration });
  const create = (overrides = {}) => createPreparedTargetManifest({
    sourceRecord: overrides.sourceRecord || sourceRecord(),
    adapter,
    effectiveConfiguration: overrides.configuration || configuration,
    preparationPlan: overrides.plan || plan,
    sandboxPolicy: overrides.policy || sandboxPolicy,
    runtime: { node: '22.16.0', docker: '27.0.0' },
    imageDigest: overrides.imageDigest || imageDigest,
    configuredImage: 'moss-eval-target:fixture',
    capabilities: configuration.capabilities,
  });
  const first = create();
  const equivalent = create();
  assert.equal(first.target_fingerprint, equivalent.target_fingerprint);
  assert.notEqual(create({ sourceRecord: sourceRecord('b'.repeat(64)) }).target_fingerprint, first.target_fingerprint);
  assert.notEqual(create({ policy: { ...sandboxPolicy, memory_mb: 4096 } }).target_fingerprint, first.target_fingerprint);
  assert.notEqual(create({ configuration: { ...configuration, runtime: 'python' } }).target_fingerprint, first.target_fingerprint);

  const saved = await savePreparedTarget(first, root);
  const reused = await savePreparedTarget(equivalent, root);
  assert.equal(saved.reused, false);
  assert.equal(reused.reused, true);
  assert.equal((await loadPreparedTarget(saved.file)).image_digest, imageDigest);
  assert.throws(
    () => create({ imageDigest: 'moss-eval-target:latest' }),
    /immutable sha256 digest/,
  );
});
