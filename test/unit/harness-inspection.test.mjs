import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createTargetProfile,
  detectMossHarness,
  inspectHarness,
  loadHarnessManifest,
  loadTargetProfile,
  saveTargetProfile,
} from '../../src/core/harness-inspection.mjs';
import { HarnessManifestError, validateHarnessManifest } from '../../src/core/harness-schema.mjs';

async function fixture(t, name = 'harness') {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `moss-eval-${name}-`));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

function sourceRecord(snapshotPath, fingerprint = 'a'.repeat(64)) {
  return { snapshot_path: snapshotPath, snapshot_fingerprint: fingerprint };
}

function manifest(overrides = {}) {
  return {
    schema_version: '1.0',
    adapter: { id: 'manifest-command', api_version: '1.0' },
    runtime: 'node',
    preparation: { working_directory: '.', steps: [{ command: 'npm', args: ['ci'], network: true }] },
    launch: { command: 'bin/agent.mjs', args: ['--json'], protocol: 'stream-json', working_directory: '.' },
    capabilities: { modes: ['stream-json'], telemetry_level: 'L1', tools: ['read_file'], tags: ['coding-repository'] },
    environment: { required: ['MODEL'], optional: [], secrets: ['API_KEY'] },
    network: { preparation_required: true, runtime_required: false, allowed_hosts: ['registry.npmjs.org'] },
    sandbox: { privileged: false, docker_socket: false, host_mounts: [] },
    ...overrides,
  };
}

async function writeMossFixture(root) {
  await fsp.mkdir(path.join(root, 'packages/moss-agent'), { recursive: true });
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'moss-workspace', workspaces: ['packages/moss-agent'], engines: { node: '>=22.16.0' },
  }));
  await fsp.writeFile(path.join(root, 'packages/moss-agent/package.json'), JSON.stringify({
    name: '@rdk-moss/agent', version: '0.6.0', bin: { moss: 'dist/cli.js' },
  }));
}

test('static MOSS detector returns evidence-backed high-confidence results without execution', async (t) => {
  const root = await fixture(t, 'moss-positive');
  await writeMossFixture(root);
  const detected = await detectMossHarness(root);
  assert.equal(detected.adapter, 'moss');
  assert.equal(detected.confidence, 1);
  assert.equal(detected.confidence_label, 'high');
  assert.equal(detected.entry_points[0].path, 'packages/moss-agent/dist/cli.js');
  assert.ok(detected.evidence.some((item) => item.field === 'bin.moss'));

  const inspection = await inspectHarness(sourceRecord(root));
  assert.equal(inspection.status, 'detected');
  assert.equal(inspection.requires_confirmation, true);
  assert.equal(inspection.candidates[0].capabilities.telemetry_level, 'L3');
});

test('static inspection is inconclusive for unrelated sources', async (t) => {
  const root = await fixture(t, 'negative');
  await fsp.writeFile(path.join(root, 'package.json'), '{"name":"unrelated"}');
  const inspection = await inspectHarness(sourceRecord(root));
  assert.equal(inspection.status, 'inconclusive');
  assert.deepEqual(inspection.candidates, []);
});

test('valid manifests are projected explicitly and conflicting static evidence is ambiguous', async (t) => {
  const root = await fixture(t, 'ambiguous');
  await writeMossFixture(root);
  await fsp.mkdir(path.join(root, '.moss-eval'));
  await fsp.writeFile(path.join(root, '.moss-eval/harness.json'), JSON.stringify(manifest()));
  const loaded = await loadHarnessManifest(root);
  assert.equal(loaded.manifest.adapter.id, 'manifest-command');
  const inspection = await inspectHarness(sourceRecord(root));
  assert.equal(inspection.status, 'ambiguous');
  assert.equal(inspection.candidates[0].confidence_label, 'explicit');
  assert.ok(inspection.evidence.some((item) => item.type === 'harness-manifest'));
});

test('manifest validation rejects unsupported versions, escaping paths, and prohibited privileges', () => {
  assert.throws(
    () => validateHarnessManifest(manifest({ schema_version: '2.0' })),
    (error) => error instanceof HarnessManifestError && /unsupported schema_version/.test(error.message),
  );
  assert.throws(
    () => validateHarnessManifest(manifest({ launch: { command: '../agent', args: [], protocol: 'one-shot' } })),
    /must not escape/,
  );
  assert.throws(
    () => validateHarnessManifest(manifest({ sandbox: { privileged: true, docker_socket: true, host_mounts: ['C:/'] } })),
    /prohibited/,
  );
});

test('invalid manifests are reported with field-level inspection warnings and never selected', async (t) => {
  const root = await fixture(t, 'invalid-manifest');
  await fsp.mkdir(path.join(root, '.moss-eval'));
  await fsp.writeFile(path.join(root, '.moss-eval/harness.json'), JSON.stringify(manifest({ schema_version: '9.0' })));
  const inspection = await inspectHarness(sourceRecord(root));
  assert.equal(inspection.status, 'invalid_manifest');
  assert.equal(inspection.manifest, null);
  assert.ok(inspection.warnings[0].errors.some((error) => error.includes('schema_version')));
});

test('guided target profiles require confirmation and become stale when source changes', async (t) => {
  const profilesRoot = await fixture(t, 'profiles');
  assert.throws(
    () => createTargetProfile({ sourceFingerprint: 'a'.repeat(64), configuration: manifest(), confirmed: false }),
    /explicit confirmation/,
  );
  const profile = createTargetProfile({
    sourceFingerprint: 'a'.repeat(64), configuration: manifest(), confirmed: true,
  });
  const file = await saveTargetProfile(profile, profilesRoot);
  const current = await loadTargetProfile(file, 'a'.repeat(64));
  const stale = await loadTargetProfile(file, 'b'.repeat(64));
  assert.equal(current.stale, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.stale_reason, 'source_fingerprint_changed');
});
