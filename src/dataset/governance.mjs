import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, directoryManifest, fileDigest, sha256 } from './canonical.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const CASE_ID = /^rf-[a-z0-9][a-z0-9-]*$/;
const TASK_ID = /^real-[a-z0-9][a-z0-9-]*$/;
const ROLES = new Set(['dataset-oracle-reviewer', 'release-owner']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function requiredString(value, field, errors) { if (typeof value !== 'string' || !value.trim()) errors.push(`${field} is required`); }
function assert(errors, label) { if (errors.length) throw Object.assign(new Error(`Invalid ${label}:\n- ${errors.join('\n- ')}`), { code: 'GOVERNANCE_CONTRACT_INVALID', errors }); }
export function digestArtifact(value) { return sha256(canonicalJson(value)); }

export function validateFailureCatalog(value) {
  const errors = [];
  if (!object(value)) throw new Error('Invalid failure catalog: document must be an object');
  if (value.schema_version !== '2.0') errors.push('schema_version must be 2.0');
  for (const key of ['id', 'version', 'repository', 'retrieved_at']) requiredString(value[key], key, errors);
  if (!Array.isArray(value.cases) || value.cases.length < 20) errors.push('cases must contain at least 20 mechanisms');
  const caseIds = new Set(); const taskIds = new Set();
  for (const [index, item] of (value.cases || []).entries()) {
    const prefix = `cases.${index}`;
    for (const key of ['case_id', 'task_id', 'title', 'stratum', 'category', 'construct', 'root_cause', 'severity', 'observed', 'expected_behavior', 'failure_revision', 'fixed_revision', 'source_path', 'failure_blob', 'fixed_blob']) requiredString(item?.[key], `${prefix}.${key}`, errors);
    if (!CASE_ID.test(item?.case_id || '')) errors.push(`${prefix}.case_id is invalid`);
    if (!TASK_ID.test(item?.task_id || '')) errors.push(`${prefix}.task_id is invalid`);
    if (caseIds.has(item?.case_id)) errors.push(`duplicate case_id ${item.case_id}`); caseIds.add(item?.case_id);
    if (taskIds.has(item?.task_id)) errors.push(`duplicate task_id ${item.task_id}`); taskIds.add(item?.task_id);
    if (!/^[a-f0-9]{40}$/.test(item?.failure_revision || '') || !/^[a-f0-9]{40}$/.test(item?.fixed_revision || '')) errors.push(`${prefix} revisions must be full Git object IDs`);
    if (!/^[a-f0-9]{40}$/.test(item?.failure_blob || '') || !/^[a-f0-9]{40}$/.test(item?.fixed_blob || '') || item?.failure_blob === item?.fixed_blob) errors.push(`${prefix} source blobs must be distinct Git object IDs`);
    if (!object(item?.scenario) || !object(item?.expected) || Object.keys(item.expected || {}).length < 3) errors.push(`${prefix} requires scenario and at least three expected invariants`);
  }
  if (!Array.isArray(value.rejections)) errors.push('rejections must be an array');
  assert(errors, 'failure catalog');
  return { ...value, catalog_digest: digestArtifact(value) };
}

export function buildProtocolManifest(input) {
  const errors = [];
  if (!SHA256.test(input.dataset_digest || '')) errors.push('dataset_digest must be SHA-256');
  if (!Array.isArray(input.tasks) || !input.tasks.length || new Set(input.tasks).size !== input.tasks.length) errors.push('tasks must be a non-empty unique array');
  if (!Number.isInteger(input.trials) || input.trials < 1) errors.push('trials must be positive');
  if (!object(input.budgets) || !object(input.environment) || !Array.isArray(input.adapters) || !input.adapters.length) errors.push('budgets, environment, and adapters are required');
  if (!['disabled', 'model-only', 'public'].includes(input.network)) errors.push('network policy is unsupported');
  assert(errors, 'protocol manifest');
  const unsigned = { schema_version: '1.0', dataset_digest: input.dataset_digest, tasks: [...input.tasks], trials: input.trials, budgets: input.budgets, timeout_seconds: input.timeout_seconds, concurrency: input.concurrency, network: input.network, environment: input.environment, adapters: input.adapters, created_at: input.created_at || new Date().toISOString() };
  return { ...unsigned, protocol_digest: digestArtifact(unsigned) };
}

export function signoffPayload(signoff) {
  return { schema_version: signoff.schema_version, reviewer_id: signoff.reviewer_id, role: signoff.role, decision: signoff.decision, artifact_digest: signoff.artifact_digest, signed_at: signoff.signed_at, key_id: signoff.key_id, algorithm: signoff.algorithm };
}

export function validateSignoffs({ artifactDigest, signoffs = [], trustedKeys = {} }) {
  const results = [];
  for (const signoff of signoffs) {
    const reasons = [];
    if (signoff?.schema_version !== '1.0' || !ROLES.has(signoff?.role) || !['approved', 'rejected'].includes(signoff?.decision)) reasons.push('schema-invalid');
    if (signoff?.artifact_digest !== artifactDigest) reasons.push('artifact-digest-mismatch');
    if (!Number.isFinite(Date.parse(signoff?.signed_at || ''))) reasons.push('timestamp-invalid');
    if (signoff?.algorithm !== 'hmac-sha256') reasons.push('algorithm-invalid');
    const key = trustedKeys[signoff?.key_id];
    if (!key) reasons.push('untrusted-key');
    if (key) {
      const expected = crypto.createHmac('sha256', key).update(canonicalJson(signoffPayload(signoff))).digest('hex');
      const actual = String(signoff.signature || '');
      if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) reasons.push('signature-invalid');
    }
    results.push({ reviewer_id: signoff?.reviewer_id || null, role: signoff?.role || null, decision: signoff?.decision || null, valid: reasons.length === 0, reasons });
  }
  const validApprovals = results.filter((item) => item.valid && item.decision === 'approved');
  const byRole = Object.fromEntries([...ROLES].map((role) => [role, validApprovals.find((item) => item.role === role) || null]));
  const roleSeparation = Boolean(byRole['dataset-oracle-reviewer'] && byRole['release-owner'] && byRole['dataset-oracle-reviewer'].reviewer_id !== byRole['release-owner'].reviewer_id);
  return { valid: roleSeparation, role_separation: roleSeparation, by_role: byRole, results, blockers: [...(!byRole['dataset-oracle-reviewer'] ? ['dataset-oracle-review-missing'] : []), ...(!byRole['release-owner'] ? ['release-owner-review-missing'] : []), ...(byRole['dataset-oracle-reviewer'] && byRole['release-owner'] && !roleSeparation ? ['review-role-separation-failed'] : [])] };
}

export async function buildHiddenBundleManifest(bundleRoot, options = {}) {
  const root = path.resolve(bundleRoot);
  const salt = options.salt;
  requiredString(salt, 'salt', []);
  if (typeof salt !== 'string' || salt.length < 16) throw new Error('Hidden bundle salt must contain at least 16 characters');
  const files = (await directoryManifest(root)).filter((item) => item.path !== 'manifest.json');
  if (!files.length) throw new Error('Hidden bundle contains no Oracle assets');
  const entries = [];
  for (const item of files) entries.push({ opaque_id: sha256(`${salt}\0${item.path}`), content_digest: await fileDigest(path.join(root, ...item.path.split('/'))), size: item.size });
  const unsigned = { schema_version: '1.0', bundle_id: options.bundleId || 'private-release-oracles', salt_id: sha256(salt).slice(0, 16), case_entries: entries.sort((a, b) => a.opaque_id.localeCompare(b.opaque_id)) };
  return { ...unsigned, bundle_digest: digestArtifact(unsigned) };
}

export async function generateReviewPacket({ corpusReport, datasetReport, calibrationReport, output }) {
  const body = { schema_version: '1.0', packet_id: `${corpusReport.corpus.id}-${corpusReport.corpus.version}`, artifact_digest: digestArtifact({ corpus_digest: corpusReport.corpus_digest, dataset_digest: datasetReport.content_digest, calibration_digest: digestArtifact(calibrationReport) }), case_ids: corpusReport.cases.filter((item) => item.accepted).map((item) => item.case_id).sort(), evidence: { corpus_digest: corpusReport.corpus_digest, dataset_digest: datasetReport.content_digest, calibration_digest: digestArtifact(calibrationReport), accepted: corpusReport.counts.accepted, task_count: datasetReport.counts?.tasks || datasetReport.tasks?.length || 0, control_count: calibrationReport.control_count }, checklist: ['source-lineage-reviewed', 'failure-and-fix-reproduced', 'minimization-preserves-mechanism', 'oracle-controls-challenge-bypasses', 'privacy-and-license-reviewed', 'coverage-limitations-acknowledged'] };
  const packet = { ...body, packet_digest: digestArtifact(body) };
  await fsp.mkdir(output, { recursive: true });
  await fsp.writeFile(path.join(output, 'review-packet.json'), JSON.stringify(packet, null, 2) + '\n', 'utf8');
  const rows = packet.case_ids.map((id) => `| ${id} | [ ] | [ ] | [ ] |`).join('\n');
  await fsp.writeFile(path.join(output, 'review-packet.md'), `# Independent review packet\n\n- Packet digest: \`${packet.packet_digest}\`\n- Evidence digest: \`${packet.artifact_digest}\`\n- Accepted mechanisms: ${packet.case_ids.length}\n\nAutomation prepared this packet but did not approve it. A real reviewer must verify the evidence and provide a detached sign-off.\n\n| Case | Source | Reproduction | Oracle |\n|---|---:|---:|---:|\n${rows}\n`, 'utf8');
  return packet;
}

export function evaluateReleaseEvidence(evidence) {
  const gates = {
    corpus: { pass: evidence.corpus?.technical_gate === 'pass' && evidence.corpus?.target?.achieved === true && evidence.corpus?.coverage_gate !== 'fail', evidence: evidence.corpus?.corpus_digest || null },
    calibration: { pass: evidence.calibration?.gate === 'pass', evidence: evidence.calibration ? digestArtifact(evidence.calibration) : null },
    source_reproduction: { pass: evidence.source_reproduction?.verified === evidence.source_reproduction?.total && evidence.source_reproduction?.total >= 20, evidence: evidence.source_reproduction || null },
    adapter_qualification: { pass: Array.isArray(evidence.adapters) && evidence.adapters.length >= 3 && evidence.adapters.every((item) => item.qualified === true), evidence: evidence.adapters || [] },
    cross_agent: { pass: evidence.cross_agent?.comparable === true && evidence.cross_agent?.agent_families >= 3, evidence: evidence.cross_agent || null },
    hidden_oracle: { pass: SHA256.test(evidence.hidden_oracle?.bundle_digest || '') && evidence.hidden_oracle?.run_passed === true && evidence.hidden_oracle?.leak_scan_passed === true, evidence: evidence.hidden_oracle || null },
    human_review: { pass: evidence.signoffs?.valid === true && evidence.signoffs?.role_separation === true, evidence: evidence.signoffs || null },
    telemetry: { pass: evidence.telemetry?.valid === true, evidence: evidence.telemetry || null },
    security: { pass: evidence.security?.secret_scan_passed === true && evidence.security?.oracle_isolation_passed === true, evidence: evidence.security || null },
    regression: { pass: evidence.regression?.passed === true, evidence: evidence.regression || null },
    packaged_client: { pass: evidence.packaged_client?.passed === true && evidence.packaged_client?.clean_windows === true, evidence: evidence.packaged_client || null },
  };
  const blockers = Object.entries(gates).filter(([, gate]) => !gate.pass).map(([name]) => `${name}-gate-not-passed`);
  const unsigned = { schema_version: '1.0', eligible: blockers.length === 0, status: blockers.length ? 'development-only' : 'release-eligible', gates, blockers, evidence_digest: digestArtifact(evidence) };
  return { ...unsigned, decision_digest: digestArtifact(unsigned) };
}

