import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildHiddenBundleManifest, buildProtocolManifest, digestArtifact, evaluateReleaseEvidence, signoffPayload, validateFailureCatalog, validateSignoffs } from '../../src/dataset/governance.mjs';
import { aggregateComparableRuns, qualifyAdapterFromRun } from '../../src/dataset/cross-agent.mjs';
import { canonicalJson } from '../../src/dataset/canonical.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const catalog = JSON.parse(await fsp.readFile(path.join(root, 'datasets', 'real-failures', 'catalog.json'), 'utf8'));

test('scaled catalog is complete, unique, and digest-stable', () => {
  const first = validateFailureCatalog(catalog); const second = validateFailureCatalog(JSON.parse(JSON.stringify(catalog)));
  assert.ok(first.cases.length >= 20); assert.equal(first.catalog_digest, second.catalog_digest);
  assert.equal(new Set(first.cases.map((item) => item.case_id)).size, first.cases.length);
  assert.equal(new Set(first.cases.map((item) => item.task_id)).size, first.cases.length);
});

test('catalog rejects incomplete lineage and duplicate mechanisms', () => {
  const incomplete = structuredClone(catalog); delete incomplete.cases[0].failure_revision;
  assert.throws(() => validateFailureCatalog(incomplete), /failure_revision/);
  const duplicate = structuredClone(catalog); duplicate.cases[1].case_id = duplicate.cases[0].case_id;
  assert.throws(() => validateFailureCatalog(duplicate), /duplicate case_id/);
});

test('protocol digest changes on drift and excludes incompatible runs', () => {
  const base = { dataset_digest: 'a'.repeat(64), tasks: ['a'], trials: 3, budgets: { seconds: 1 }, timeout_seconds: 1, concurrency: 1, network: 'disabled', environment: { os: 'linux' }, adapters: [{ family: 'moss' }], created_at: '2026-01-01T00:00:00Z' };
  const protocol = buildProtocolManifest(base); const drift = buildProtocolManifest({ ...base, trials: 4 });
  assert.notEqual(protocol.protocol_digest, drift.protocol_digest);
  const trial = { instruction_delivered: true, workspace_isolated: true, receipt_present: true, exit_handled: true, transcript_captured: true, timeout_enforced: true, secret_cleanup: true };
  const qualification = qualifyAdapterFromRun({ agent_family: 'moss', adapter_id: 'moss', adapter_version: '1', protocol_digest: protocol.protocol_digest, trials: [trial] });
  assert.equal(qualification.qualified, true);
  const comparison = aggregateComparableRuns({ protocol, qualifications: [qualification], runs: [{ agent_family: 'moss', run_id: 'ok', protocol_digest: protocol.protocol_digest, summary_digest: 'b'.repeat(64), metrics: {} }, { agent_family: 'other', run_id: 'drift', protocol_digest: drift.protocol_digest, summary_digest: 'c'.repeat(64), metrics: {} }] });
  assert.equal(comparison.comparable, false); assert.equal(comparison.excluded.length, 1);
});

test('cross-Agent aggregation includes only three qualified protocol-compatible families', () => {
  const protocol = buildProtocolManifest({ dataset_digest: 'a'.repeat(64), tasks: ['one'], trials: 3, budgets: { seconds: 1 }, timeout_seconds: 1, concurrency: 1, network: 'disabled', environment: { os: 'linux' }, adapters: [{ family: 'moss' }, { family: 'claude' }, { family: 'codex' }], created_at: '2026-01-01T00:00:00Z' });
  const trial = { instruction_delivered: true, workspace_isolated: true, receipt_present: true, exit_handled: true, transcript_captured: true, timeout_enforced: true, secret_cleanup: true };
  const qualifications = ['moss', 'claude', 'codex'].map((family) => qualifyAdapterFromRun({ agent_family: family, adapter_id: family, adapter_version: '1', protocol_digest: protocol.protocol_digest, trials: [trial] }));
  const metrics = { pass_at_1: { value: 1, successes: 1, total: 1 }, pass_at_k: { value: null, successes: 0, total: 0 }, pass_pow_k: { value: null, successes: 0, total: 0 }, valid_trial_rate: { value: 1, successes: 1, total: 1 }, cost: { total_usd: 0 }, latency_ms: { p50: 1, p95: 1 }, telemetry: { valid_rate: { value: 1, successes: 1, total: 1 } } };
  const runs = ['moss', 'claude', 'codex'].map((family) => ({ agent_family: family, run_id: family, protocol_digest: protocol.protocol_digest, summary_digest: 'b'.repeat(64), metrics }));
  runs.push({ agent_family: 'drifted', run_id: 'drifted', protocol_digest: 'c'.repeat(64), summary_digest: 'd'.repeat(64), metrics });
  const report = aggregateComparableRuns({ protocol, qualifications, runs });
  assert.equal(report.comparable, true);
  assert.equal(report.agent_families, 3);
  assert.equal(report.included.length, 3);
  assert.equal(report.excluded[0].reason, 'protocol-digest-mismatch');
  assert.deepEqual(report.included[0].metrics, metrics);
});

test('human sign-offs fail closed for missing, stale, malformed, and same identity', () => {
  const artifactDigest = 'd'.repeat(64); const key = 'review-key-only-for-unit-test';
  const make = (reviewer_id, role, digest = artifactDigest) => { const value = { schema_version: '1.0', reviewer_id, role, decision: 'approved', artifact_digest: digest, signed_at: '2026-08-26T00:00:00Z', key_id: reviewer_id, algorithm: 'hmac-sha256' }; return { ...value, signature: crypto.createHmac('sha256', key).update(canonicalJson(signoffPayload(value))).digest('hex') }; };
  assert.equal(validateSignoffs({ artifactDigest }).valid, false);
  assert.equal(validateSignoffs({ artifactDigest, signoffs: [make('a', 'dataset-oracle-reviewer', 'e'.repeat(64))], trustedKeys: { a: key } }).valid, false);
  const same = [make('same', 'dataset-oracle-reviewer'), make('same', 'release-owner')];
  assert.equal(validateSignoffs({ artifactDigest, signoffs: same, trustedKeys: { same: key } }).valid, false);
});

test('hidden bundle identity changes without exposing paths', async (t) => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-hidden-')); t.after(() => fsp.rm(temp, { recursive: true, force: true }));
  await fsp.writeFile(path.join(temp, 'oracle-a.json'), '{"answer":1}');
  const first = await buildHiddenBundleManifest(temp, { salt: '0123456789abcdef' });
  assert.equal(JSON.stringify(first).includes('oracle-a.json'), false);
  await fsp.writeFile(path.join(temp, 'oracle-a.json'), '{"answer":2}');
  const second = await buildHiddenBundleManifest(temp, { salt: '0123456789abcdef' });
  assert.notEqual(first.bundle_digest, second.bundle_digest);
});

test('development evidence never bypasses release gates', () => {
  const decision = evaluateReleaseEvidence({ corpus: { technical_gate: 'pass', target: { achieved: true }, coverage_gate: 'pass', corpus_digest: 'a'.repeat(64) }, calibration: { gate: 'pass' }, source_reproduction: { verified: 21, total: 21 }, adapters: [], security: { secret_scan_passed: true, oracle_isolation_passed: true } });
  assert.equal(decision.eligible, false); assert.equal(decision.status, 'development-only');
  assert.ok(decision.blockers.includes('hidden_oracle-gate-not-passed')); assert.ok(decision.blockers.includes('human_review-gate-not-passed'));
  assert.equal(digestArtifact(decision).length, 64);
});
