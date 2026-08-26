import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DatasetContractError,
  deriveTaskState,
  loadProfessionalDataset,
  validateTaskCard,
} from '../../src/dataset/contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const datasetRoot = path.join(root, 'datasets/professional-seed');

test('professional seed cards satisfy the strict contract but do not self-assert release state', async () => {
  const dataset = await loadProfessionalDataset(datasetRoot);
  assert.equal(dataset.cards.length, 3);
  for (const card of dataset.cards) {
    assert.equal(card.oracle_isolation, 'evaluator-only');
    assert.equal(card.controls.filter((item) => item.kind === 'positive').length, 2);
    assert.equal(card.controls.filter((item) => item.kind === 'negative').length, 3);
    const state = deriveTaskState(card, { technical_passed: true, calibration_passed: true, pilot_ready: false }, dataset.manifest.policy);
    assert.equal(state.state, 'calibrated');
    assert.equal(state.release_eligible, false);
    assert.ok(state.blockers.includes('independent-human-review-not-established'));
    assert.ok(state.blockers.includes('hidden-oracle-not-established'));
  }
});

test('contract rejects author self-review and missing task-specific controls', async () => {
  const dataset = await loadProfessionalDataset(datasetRoot);
  const card = structuredClone(Object.fromEntries(Object.entries(dataset.cards[0]).filter(([key]) => key !== '_meta')));
  card.reviews = [{ reviewer_id: card.author.id, role: 'domain', decision: 'approved' }];
  card.controls = card.controls.filter((control) => control.kind === 'positive');
  assert.throws(() => validateTaskCard(card, dataset.manifest.policy), DatasetContractError);
});

test('loader rejects escaping task paths', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(process.cwd(), '.moss-eval-contract-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  const manifest = JSON.parse(await fsp.readFile(path.join(datasetRoot, 'dataset.json'), 'utf8'));
  manifest.tasks = ['../outside/task-card.json'];
  await fsp.writeFile(path.join(temporary, 'dataset.json'), JSON.stringify(manifest));
  await assert.rejects(() => loadProfessionalDataset(temporary), /forbidden path segment|escapes/);
});

test('loader rejects duplicate task identities', async (t) => {
  const temporary = await fsp.mkdtemp(path.join(process.cwd(), '.moss-eval-contract-'));
  t.after(() => fsp.rm(temporary, { recursive: true, force: true }));
  await fsp.cp(datasetRoot, temporary, { recursive: true });
  const manifestPath = path.join(temporary, 'dataset.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.tasks.push(manifest.tasks[0]);
  await fsp.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => loadProfessionalDataset(temporary), /duplicate/i);
});
