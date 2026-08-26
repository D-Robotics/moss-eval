import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditFailureCorpus, writeFailureAuditReport } from '../../src/dataset/failure-audit.mjs';
import { FailureCaseContractError, deriveFailureCaseState, loadFailureCorpus, validateCalibrationEvidence, validateFailureCase, validateMinimizationReceipt, validateReproductionDefinition, validateReproductionReceipt } from '../../src/dataset/failure-contract.mjs';
import { fileDigest } from '../../src/dataset/canonical.mjs';

function caseRecord(overrides = {}) {
  return {
    schema_version: '1.0', id: 'rf-agent-context-budget', version: '0.1.0', title: 'Agent context exceeds task budget',
    stratum: 'agent-behavior', category: 'context-efficiency', root_cause_family: 'unbounded-context-loading', source_project: 'D-Robotics/moss',
    construct: { primary: 'bounded-context-use', tags: ['context', 'budget'] },
    observed_failure: 'The Agent completes the task but exceeds the declared input-token budget.', expected_behavior: 'Complete within the declared budget.',
    author: { id: 'dataset-author', type: 'human-supervised' },
    source: { kind: 'evaluation-trace', canonical_locator: 'artifact://run-1/trial.json', retrieved_at: '2026-08-26T13:12:06.394Z', allowed_use: 'authorized local evaluation evidence', license_or_consent: 'workspace owner authorized evaluation', privacy_classification: 'internal-sanitized', redaction_status: 'secret-scan-passed' },
    evidence: [{ id: 'trial', type: 'evaluation-trial', locator: 'artifact://run-1/trial.json', retrieved_at: '2026-08-26T13:12:06.394Z', claim: 'Outcome passes while input tokens exceed budget.', availability: 'local-retained', sha256: 'a'.repeat(64) }],
    triage: { decision: 'accepted', reason_codes: [] }, reproduction: null, minimization: null, task_mapping: null, reviews: [],
    ...overrides,
  };
}

async function corpusFixture(t, records) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-failure-corpus-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const cases = [];
  const caseDigests = {};
  for (const record of records) {
    const relative = `cases/${record.id}/case.json`;
    await fsp.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fsp.writeFile(path.join(root, relative), JSON.stringify(record, null, 2) + '\n');
    cases.push(relative);
    caseDigests[relative] = await fileDigest(path.join(root, relative));
  }
  await fsp.writeFile(path.join(root, 'registry.json'), JSON.stringify({
    schema_version: '1.0', id: 'real-agent-failures', version: '0.1.0-development', title: 'Real failures', cases, case_digests: caseDigests, supplemental_files: [],
    policy: { pilot_candidate_target: 5, accepted_case_target_minimum: 20, accepted_case_target_maximum: 50, require_primary_evidence: true },
  }, null, 2) + '\n');
  return root;
}

test('failure case contract validates evidence and rejects authored state', () => {
  assert.equal(validateFailureCase(caseRecord()).id, 'rf-agent-context-budget');
  assert.throws(() => validateFailureCase(caseRecord({ state: 'release-eligible' })), FailureCaseContractError);
  assert.throws(() => validateFailureCase(caseRecord({ source: { ...caseRecord().source, kind: 'blog-summary' } })), FailureCaseContractError);
});

test('ordinary product defects cannot inflate accepted Agent failure counts', async (t) => {
  const product = caseRecord({ id: 'rf-product-only', stratum: 'product-defect', triage: { decision: 'rejected', reason_codes: ['ordinary-product-defect'] } });
  const root = await corpusFixture(t, [caseRecord(), product]);
  const audited = await auditFailureCorpus(root);
  assert.equal(audited.report.technical_gate, 'fail');
  assert.ok(audited.report.blockers.includes('accepted-case-task-mapping-not-one-to-one'));
  assert.equal(audited.report.counts.discovered, 2);
  assert.equal(audited.report.counts.accepted, 1);
  assert.equal(audited.report.counts.rejected, 1);
  assert.equal(audited.report.target.achieved, false);
});

test('exact evidence duplicates count only the canonical first case', async (t) => {
  const duplicate = caseRecord({ id: 'rf-agent-context-budget-alias', title: 'Duplicate report' });
  const root = await corpusFixture(t, [caseRecord(), duplicate]);
  const audited = await auditFailureCorpus(root);
  assert.equal(audited.report.exact_duplicates.length, 1);
  assert.equal(audited.report.counts.accepted, 1);
  assert.ok(audited.report.cases.find((item) => item.case_id === duplicate.id).blockers.includes('exact-evidence-duplicate'));
});

test('derived lifecycle advances only from retained evidence', () => {
  const record = caseRecord({
    reproduction: { definition_path: 'reproduction.json', receipt_path: 'receipt.json' },
    minimization: { receipt_path: 'minimization.json' },
    task_mapping: { task_id: 'regression-001', calibration_path: 'calibration.json', hidden_oracle_digest: 'b'.repeat(64) },
    reviews: [{ reviewer_id: 'domain-reviewer', role: 'domain', decision: 'approved' }, { reviewer_id: 'evaluation-reviewer', role: 'evaluation', decision: 'approved' }],
  });
  assert.equal(deriveFailureCaseState(record, { reproduction: { status: 'reproduced' }, minimization: { status: 'preserved' }, calibration: { gate: 'pass' }, pilot: { ready: true } }).state, 'release-eligible');
  assert.equal(deriveFailureCaseState(record, {}).state, 'triaged');
});

test('private incident privacy mismatch fails closed and reports are written', async (t) => {
  const privateCase = caseRecord({ source: { ...caseRecord().source, kind: 'authorized-incident', privacy_classification: 'public' } });
  const root = await corpusFixture(t, [privateCase]);
  const loaded = await loadFailureCorpus(root);
  assert.equal(loaded.cases.length, 1);
  const { report } = await auditFailureCorpus(root);
  assert.equal(report.counts.accepted, 0);
  assert.ok(report.cases[0].blockers.includes('private-source-privacy-invalid'));
  const output = path.join(root, 'report');
  await writeFailureAuditReport(report, output);
  assert.match(await fsp.readFile(path.join(output, 'audit.md'), 'utf8'), /Candidate count is not/);
});

test('reproduction and minimization contracts pin revisions, fixture, and signatures', () => {
  const record = caseRecord();
  const definition = validateReproductionDefinition({
    schema_version: '1.0', case_id: record.id,
    target: { repository: 'https://github.com/D-Robotics/moss.git', failure_revision: 'a'.repeat(40), fixed_revision: 'b'.repeat(40) },
    environment: { runner: 'node', network: 'disabled', timeout_seconds: 30 },
    fixture: { path: 'fixture', sha256: 'c'.repeat(64) },
    steps: {
      failure: { command: ['node', 'verify.mjs', 'failure'], expect: { exit_codes: [0], stdout_matches: 'failure-reproduced' } },
      fixed: { command: ['node', 'verify.mjs', 'fixed'], expect: { exit_codes: [0], stdout_matches: 'fixed-behavior' } },
    },
  }, record);
  assert.equal(validateReproductionReceipt({
    schema_version: '1.0', case_id: record.id, status: 'reproduced', definition_sha256: 'd'.repeat(64), fixture_sha256: 'c'.repeat(64), environment_fingerprint: 'e'.repeat(64), executed_at: '2026-08-26T13:00:00Z', duration_ms: 5, phases: { failure: {}, fixed: {} },
  }, record, definition).status, 'reproduced');
  assert.equal(validateMinimizationReceipt({ schema_version: '1.0', case_id: record.id, status: 'preserved', original_signature: 'same-failure', minimized_signature: 'same-failure', rationale: 'Small deterministic fixture', fixture_sha256: 'c'.repeat(64) }, record).status, 'preserved');
});

test('calibration evidence requires isolated 2-positive/3-negative exact controls', () => {
  const record = caseRecord({ task_mapping: { task_id: 'real-context-budget' } });
  const mapping = { task_id: 'real-context-budget' };
  const control = (id, kind, pass) => ({ control_id: id, kind, expected_pass: pass, actual_pass: pass, correct: true, execution_status: 'completed', oracle_mutated_workspace: false, reason_codes: [] });
  const evidence = {
    schema_version: '1.0', case_id: record.id, task_id: mapping.task_id,
    dataset: { id: 'real-pilot', version: '0.1.0-development' }, dataset_digest: 'f'.repeat(64), gate: 'pass', control_count: 5,
    positive_false_negatives: 0, negative_false_positives: 0, execution_errors: 0, isolated_workspaces: true,
    controls: [control('p1', 'positive', true), control('p2', 'positive', true), control('n1', 'negative', false), control('n2', 'negative', false), control('n3', 'negative', false)],
  };
  assert.equal(validateCalibrationEvidence(evidence, record, mapping).gate, 'pass');
  assert.throws(() => validateCalibrationEvidence({ ...evidence, isolated_workspaces: false }, record, mapping), FailureCaseContractError);
});

test('audit fails closed on case drift and undeclared files', async (t) => {
  const root = await corpusFixture(t, [caseRecord()]);
  const file = path.join(root, 'cases', 'rf-agent-context-budget', 'case.json');
  const changed = JSON.parse(await fsp.readFile(file, 'utf8'));
  changed.title = 'Changed without digest update';
  await fsp.writeFile(file, JSON.stringify(changed, null, 2) + '\n');
  await fsp.writeFile(path.join(root, 'undeclared.txt'), 'not declared\n');
  const { report } = await auditFailureCorpus(root);
  assert.equal(report.technical_gate, 'fail');
  assert.ok(report.blockers.includes('case-content-drift'));
  assert.ok(report.undeclared_files.includes('undeclared.txt'));
});
