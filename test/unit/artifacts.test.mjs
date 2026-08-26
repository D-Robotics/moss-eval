import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ArtifactReadError,
  loadRunArtifacts,
  loadRunTrials,
} from '../../src/core/artifacts.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('canonical artifact reader loads the current nested trial layout', async () => {
  const run = await loadRunArtifacts(path.join(root, 'test/fixtures/artifacts/run-v1'));
  assert.equal(run.metadata.run_id, 'fixture-run-v1');
  assert.equal(run.summary.trial_count, 1);
  assert.equal(run.release_decision.status, 'development-only');
  assert.equal(run.trials.length, 1);
  assert.equal(run.trials[0].task.id, 'fixture-task');
  assert.equal(run.trials[0].agent, 'fixture-agent');
});

test('artifact reader rejects unsupported schema versions with diagnostics', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-artifact-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const trialDirectory = path.join(directory, 'trials/task/agent/trial-1');
  await fsp.mkdir(trialDirectory, { recursive: true });
  await fsp.writeFile(path.join(trialDirectory, 'trial.json'), JSON.stringify({
    schema_version: '99.0', task: { id: 'task' }, agent: 'agent', replicate: 1,
  }));
  await assert.rejects(
    loadRunTrials(directory),
    (error) => error instanceof ArtifactReadError && error.code === 'UNSUPPORTED_ARTIFACT_SCHEMA',
  );
});

test('artifact reader identifies the obsolete desktop trial layout', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-legacy-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  await fsp.mkdir(path.join(directory, 'task-a'), { recursive: true });
  await fsp.writeFile(path.join(directory, 'task-a/trial.json'), '{}');
  await assert.rejects(
    loadRunTrials(directory),
    (error) => error instanceof ArtifactReadError && error.code === 'LEGACY_ARTIFACT_LAYOUT',
  );
});
