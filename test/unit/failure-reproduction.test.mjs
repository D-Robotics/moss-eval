import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { directoryDigest, fileDigest } from '../../src/dataset/canonical.mjs';
import { loadFailureCorpus } from '../../src/dataset/failure-contract.mjs';
import { createMinimizationReceipt, createTaskMapping, reproduceFailureCase } from '../../src/dataset/failure-reproduction.mjs';

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-failure-repro-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'cases', 'rf-retry');
  const fixtureRoot = path.join(directory, 'fixture');
  await fsp.mkdir(fixtureRoot, { recursive: true });
  await fsp.writeFile(path.join(fixtureRoot, 'verify.mjs'), "const phase=process.argv[2]; console.log(phase==='failure'?'failure-reproduced':'fixed-behavior');\n");
  const fixtureSha = await directoryDigest(fixtureRoot);
  const definition = {
    schema_version: '1.0', case_id: 'rf-retry', target: { repository: 'https://github.com/D-Robotics/moss.git', failure_revision: 'a'.repeat(40), fixed_revision: 'b'.repeat(40) },
    environment: { runner: 'node', network: 'disabled', timeout_seconds: 10 }, fixture: { path: 'fixture', sha256: fixtureSha },
    steps: { failure: { command: ['node', 'verify.mjs', '{phase}'], expect: { exit_codes: [0], stdout_matches: 'failure-reproduced' } }, fixed: { command: ['node', 'verify.mjs', '{phase}'], expect: { exit_codes: [0], stdout_matches: 'fixed-behavior' } } },
  };
  await fsp.writeFile(path.join(directory, 'reproduction.json'), JSON.stringify(definition, null, 2) + '\n');
  const caseRecord = {
    schema_version: '1.0', id: 'rf-retry', version: '0.1.0', title: 'Retry defect', stratum: 'agent-harness', category: 'recovery', root_cause_family: 'retry', source_project: 'moss',
    construct: { primary: 'retry', tags: ['retry'] }, observed_failure: 'Retry repeats forever.', expected_behavior: 'Retry stops.', author: { id: 'author', type: 'human' },
    source: { kind: 'github-pr', canonical_locator: 'https://github.com/D-Robotics/moss/pull/1', retrieved_at: '2026-08-26T00:00:00Z', allowed_use: 'public', license_or_consent: 'MIT', privacy_classification: 'public', redaction_status: 'none-needed' },
    evidence: [{ id: 'pr', type: 'fix', locator: 'https://github.com/D-Robotics/moss/pull/1', retrieved_at: '2026-08-26T00:00:00Z', claim: 'Fix', availability: 'public', revision: 'b'.repeat(40) }],
    triage: { decision: 'accepted', reason_codes: [] }, reproduction: { definition_path: 'reproduction.json', receipt_path: 'reproduction-receipt.json' }, minimization: { receipt_path: 'minimization.json' }, task_mapping: null, reviews: [],
  };
  await fsp.writeFile(path.join(directory, 'case.json'), JSON.stringify(caseRecord, null, 2) + '\n');
  const relative = 'cases/rf-retry/case.json';
  await fsp.writeFile(path.join(root, 'registry.json'), JSON.stringify({ schema_version: '1.0', id: 'test', version: '0.1.0-development', title: 'Test', cases: [relative], case_digests: { [relative]: await fileDigest(path.join(directory, 'case.json')) }, supplemental_files: [], policy: { pilot_candidate_target: 1, accepted_case_target_minimum: 1, accepted_case_target_maximum: 2, require_primary_evidence: true } }, null, 2) + '\n');
  return root;
}

test('reproduction requires authorization and runs isolated red/green phases', async (t) => {
  const root = await fixture(t);
  await assert.rejects(reproduceFailureCase(root, 'rf-retry'), (error) => error.code === 'REPRODUCTION_NOT_AUTHORIZED');
  const before = await directoryDigest(path.join(root, 'cases', 'rf-retry', 'fixture'));
  const receipt = await reproduceFailureCase(root, 'rf-retry', { authorized: true, writeReceipt: true });
  assert.equal(receipt.status, 'reproduced');
  assert.equal(receipt.phases.failure.matched, true);
  assert.equal(receipt.phases.fixed.matched, true);
  assert.equal(await directoryDigest(path.join(root, 'cases', 'rf-retry', 'fixture')), before);
});

test('minimization and promotion fail closed until evidence exists', async (t) => {
  const root = await fixture(t);
  const receipt = await reproduceFailureCase(root, 'rf-retry', { authorized: true, writeReceipt: true });
  let corpus = await loadFailureCorpus(root);
  const record = corpus.cases[0];
  const minimized = createMinimizationReceipt(record, receipt, { original_signature: 'retry-loop', minimized_signature: 'retry-loop', rationale: 'Preserves the retry state transition.' });
  await fsp.writeFile(path.join(record._meta.directory, 'minimization.json'), JSON.stringify(minimized, null, 2) + '\n');
  corpus = await loadFailureCorpus(root);
  const mapping = createTaskMapping(corpus.cases[0], { taskId: 'real-retry' });
  assert.equal(mapping.track, 'harness-regression');
  assert.equal(mapping.source_evidence_digest, corpus.cases[0]._meta.evidenceIdentity);
});
