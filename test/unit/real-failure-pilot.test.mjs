import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { auditProfessionalDataset } from '../../src/dataset/audit.mjs';
import { calibrateProfessionalDataset } from '../../src/dataset/calibration.mjs';
import { buildProfessionalRelease } from '../../src/dataset/release.mjs';
import { loadTasks } from '../../src/core/task-loader.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const datasetRoot = path.join(projectRoot, 'datasets', 'real-failure-pilot');

test('scaled real failure Pilot has at least twenty outcome-first tasks across separate tracks', async () => {
  const { report, dataset } = await auditProfessionalDataset(datasetRoot);
  assert.equal(report.technical_gate, 'pass');
  assert.ok(report.coverage.task_count >= 20);
  assert.equal(report.coverage.tracks['target-regression'], 2);
  assert.equal(report.coverage.tracks['harness-regression'], report.coverage.task_count - 2);
  assert.equal(new Set(dataset.cards.map((card) => card.source_case_id)).size, report.coverage.task_count);
  for (const card of dataset.cards) {
    assert.equal(card.oracle_isolation, 'evaluator-only');
    assert.equal(card.oracle.distribution, 'public-development');
    assert.equal(card.controls.filter((item) => item.kind === 'positive').length, 2);
    assert.equal(card.controls.filter((item) => item.kind === 'negative').length, 4);
    assert.match(card.instruction, /TOP-LEVEL JSON fields/);
    assert.doesNotMatch(card.instruction, /expected_tool_calls|tool order/i);
  }
});

test('real failure Pilot runtime tasks load into the core scheduler', async () => {
  const tasks = await loadTasks([path.join(datasetRoot, 'tasks')]);
  assert.ok(tasks.length >= 20);
  assert.equal(tasks.filter((task) => task.professional_dataset.track === 'target-regression').length, 2);
  assert.equal(tasks.filter((task) => task.professional_dataset.track === 'harness-regression').length, tasks.length - 2);
});

test('real failure Pilot calibrates exactly and public release stays blocked', async () => {
  const { report } = await calibrateProfessionalDataset(datasetRoot);
  assert.equal(report.gate, 'pass');
  assert.equal(report.control_count, report.task_count * 6);
  assert.equal(report.positive_false_negative_rate, 0);
  assert.equal(report.negative_false_positive_rate, 0);
  assert.equal(report.execution_error_rate, 0);
  assert.ok(report.tasks.every((task) => task.gate === 'pass' && task.isolated_workspaces));
  const released = await buildProfessionalRelease(datasetRoot, { calibration: report });
  assert.equal(released.result.release_eligible, false);
  assert.ok(released.result.blockers.includes('all-tasks-require-hidden-external-oracles'));
  assert.ok(released.result.blockers.includes('independent-human-review-not-established'));
  assert.ok(released.result.blockers.includes('cross-agent-pilot-not-established'));
});
