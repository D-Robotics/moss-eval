import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTasks } from '../../src/core/task-loader.mjs';
import { scoreToolExpectations } from '../../src/core/native-telemetry.mjs';
import { calibrateJudgeLabels } from '../../src/core/judge-calibration.mjs';
import { evaluateReleaseGate } from '../../src/core/release-gate.mjs';
import { GATED_TASK_IDS, referenceReceipt, verifySemanticOutcome } from '../../taskpacks/core/semantic-contracts.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('exactly 16 reviewed tasks form the gated release suite', async () => {
  const tasks = await loadTasks([path.join(root, 'taskpacks/core')]);
  const gated = tasks.filter((task) => task.quality_tier === 'gated');
  assert.deepEqual(gated.map((task) => task.id), [...GATED_TASK_IDS]);
  assert.equal(tasks.filter((task) => task.quality_tier === 'experimental').length, 34);
  assert.ok(gated.every((task) => task.suites.includes('release')));
  assert.ok(tasks.filter((task) => task.quality_tier === 'experimental').every((task) => !task.suites.includes('release')));
});

test('semantic output oracle rejects a receipt that only looks complete', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-semantic-'));
  try {
    const receipt = { ...referenceReceipt('install-001'), diagnosis: { classification: 'unsupported-node-version', detected: '22.16.0', required: '22.16.0' } };
    const result = await verifySemanticOutcome('install-001', receipt, workspace);
    assert.equal(result.applicable, true);
    assert.match(result.failures.join(' '), /diagnosis.detected/);
  } finally { await fsp.rm(workspace, { recursive: true, force: true }); }
});

test('tool quality covers format arguments order redundancy and F1', () => {
  const scored = scoreToolExpectations([
    { call_id: '1', tool: 'read_file', arguments: { path: 'a' } },
    { call_id: '2', tool: 'edit_file', arguments: {} },
    { call_id: '3', tool: 'edit_file', arguments: {} },
  ], { expected: ['read_file', 'edit_file'], expected_order: ['read_file', 'edit_file'], argument_requirements: { edit_file: ['path'] } });
  assert.equal(scored.f1, 1);
  assert.equal(scored.order_passed, true);
  assert.equal(scored.argument_accuracy, 0);
  assert.equal(scored.redundant_call_count, 1);
});

test('judge calibration and release traffic light enforce thresholds', async () => {
  const dataset = JSON.parse(await fsp.readFile(path.join(root, 'calibration/judge-labels.v1.json'), 'utf8'));
  assert.equal(calibrateJudgeLabels(dataset.records).gate, 'pass');
  const candidate = { source_commit: 'a'.repeat(40), image_digests: ['sha256:' + 'b'.repeat(64)], prepared_target_fingerprints:['c'.repeat(64)], adapters:[{id:'moss',version:'1'}], quality_tracks: { gated: { coverage: { eligible_rate: { value: 1 } }, pass_at_1: { value: 0.9 }, safety_violation_rate: { value: 0 }, valid_trial_rate: { value: 1 } } } };
  assert.equal(evaluateReleaseGate(candidate).status, 'green');
  assert.equal(evaluateReleaseGate({ ...candidate, image_digests: [] }).status, 'red');
});
