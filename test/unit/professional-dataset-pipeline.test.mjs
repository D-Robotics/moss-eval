import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditProfessionalDataset } from '../../src/dataset/audit.mjs';
import { calibrateProfessionalDataset } from '../../src/dataset/calibration.mjs';
import { buildProfessionalRelease } from '../../src/dataset/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const datasetRoot = path.join(root, 'datasets/professional-seed');

test('technical audit passes while professional release validity remains not established', async () => {
  const audited = await auditProfessionalDataset(datasetRoot);
  assert.equal(audited.report.technical_gate, 'pass');
  assert.equal(audited.report.professional_release_status, 'not-established');
  assert.equal(audited.report.tasks.length, 3);
  assert.ok(audited.report.blockers.includes('independent-human-review-not-established'));
  assert.ok(audited.report.blockers.includes('hidden-oracle-not-established'));
});

test('task-specific calibration executes 15 controls in isolated workspaces', async () => {
  const calibrated = await calibrateProfessionalDataset(datasetRoot);
  assert.equal(calibrated.report.gate, 'pass');
  assert.equal(calibrated.report.control_count, 15);
  assert.equal(calibrated.report.positive_false_negative_rate, 0);
  assert.equal(calibrated.report.negative_false_positive_rate, 0);
  assert.equal(calibrated.report.execution_error_rate, 0);
  for (const task of calibrated.report.tasks) {
    assert.equal(task.gate, 'pass');
    assert.equal(task.isolated_workspaces, true);
    assert.equal(new Set(task.controls.map((control) => control.workspace_instance)).size, 5);
  }
});

test('release remains blocked with public Oracles, no human review and no pilot', async () => {
  const calibrated = await calibrateProfessionalDataset(datasetRoot);
  const released = await buildProfessionalRelease(datasetRoot, { calibration: calibrated.report });
  assert.equal(released.result.status, 'not-established');
  assert.equal(released.result.release_eligible, false);
  assert.equal(released.manifest, null);
  assert.ok(released.result.blockers.includes('all-tasks-require-hidden-external-oracles'));
  assert.ok(released.result.blockers.includes('hidden-oracle-bundle-not-provided'));
});

test('fixture content drift fails the technical audit', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-prof-drift-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  await fsp.cp(datasetRoot, temporary, { recursive: true });
  await fsp.appendFile(path.join(temporary, 'tasks/pro-code-001/fixture/src/add.mjs'), '\n// drift\n');
  const audited = await auditProfessionalDataset(temporary);
  assert.equal(audited.report.technical_gate, 'fail');
  assert.ok(audited.report.tasks.find((task) => task.task_id === 'pro-code-001').blockers.includes('fixture-digest-mismatch'));
});
