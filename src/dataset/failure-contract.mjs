import fsp from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, safeDatasetPath, sha256 } from './canonical.mjs';

const STRATA = new Set(['agent-behavior', 'agent-harness', 'product-defect']);
const SOURCE_KINDS = new Set(['github-issue', 'github-pr', 'fix-commit', 'release-note', 'evaluation-trace', 'authorized-incident']);
const TRIAGE_DECISIONS = new Set(['pending', 'accepted', 'rejected']);
const REVIEW_ROLES = new Set(['domain', 'evaluation', 'privacy-security']);
const REPRODUCTION_RUNNERS = new Set(['node', 'docker']);
const NETWORK_MODES = new Set(['disabled', 'public']);
const PROMOTION_TRACKS = new Set(['target-regression', 'harness-regression', 'general-capability', 'private-business']);

export class FailureCaseContractError extends Error {
  constructor(file, errors) {
    super(`Invalid failure corpus artifact ${file}:\n- ${errors.join('\n- ')}`);
    this.name = 'FailureCaseContractError';
    this.file = file;
    this.errors = errors;
  }
}

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const string = (value) => typeof value === 'string' && value.trim().length > 0;
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

function required(parent, key, prefix, errors) {
  if (!object(parent) || !string(parent[key])) errors.push(`${prefix}.${key} is required`);
}

function semver(value, field, errors) {
  if (!string(value) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) errors.push(`${field} must be a semantic version`);
}

function timestamp(value, field, errors) {
  if (!string(value) || !Number.isFinite(Date.parse(value))) errors.push(`${field} must be an ISO timestamp`);
}

export function validateFailureRegistry(value, file = 'registry.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  for (const key of ['id', 'title']) required(value, key, 'registry', errors);
  semver(value.version, 'registry.version', errors);
  if (!Array.isArray(value.cases) || value.cases.length === 0 || value.cases.some((item) => !string(item))) errors.push('registry.cases must be a non-empty path array');
  if (!object(value.case_digests)) errors.push('registry.case_digests is required');
  else for (const relative of value.cases || []) if (!digest(value.case_digests[relative])) errors.push(`registry.case_digests.${relative} must be SHA-256`);
  if (!Array.isArray(value.supplemental_files) || value.supplemental_files.some((item) => !string(item))) errors.push('registry.supplemental_files must be an array of paths');
  if (!object(value.policy)) errors.push('registry.policy is required');
  else {
    for (const key of ['pilot_candidate_target', 'accepted_case_target_minimum', 'accepted_case_target_maximum']) {
      if (!Number.isInteger(value.policy[key]) || value.policy[key] < 1) errors.push(`registry.policy.${key} must be a positive integer`);
    }
    if (value.policy.accepted_case_target_minimum > value.policy.accepted_case_target_maximum) errors.push('accepted case target range is invalid');
    if (value.policy.require_primary_evidence !== true) errors.push('registry.policy.require_primary_evidence must be true');
    for (const key of ['maximum_source_change_concentration', 'maximum_construct_concentration']) {
      if (value.policy[key] !== undefined && (!Number.isFinite(value.policy[key]) || value.policy[key] <= 0 || value.policy[key] > 1)) errors.push(`registry.policy.${key} must be greater than zero and at most one`);
    }
  }
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateReproductionDefinition(value, caseRecord, file = 'reproduction.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  if (value.case_id !== caseRecord.id) errors.push('case_id must match case');
  if (!object(value.target)) errors.push('target is required');
  else {
    for (const key of ['repository', 'failure_revision', 'fixed_revision']) required(value.target, key, 'target', errors);
    for (const key of ['failure_revision', 'fixed_revision']) if (!/^[a-f0-9]{40}$/i.test(value.target[key] || '')) errors.push(`target.${key} must be a 40-character Git revision`);
    if (value.target.failure_revision === value.target.fixed_revision) errors.push('failure and fixed revisions must differ');
  }
  if (!object(value.environment) || !REPRODUCTION_RUNNERS.has(value.environment.runner)) errors.push('environment.runner is unsupported');
  else {
    if (!NETWORK_MODES.has(value.environment.network)) errors.push('environment.network is unsupported');
    if (!Number.isInteger(value.environment.timeout_seconds) || value.environment.timeout_seconds < 1 || value.environment.timeout_seconds > 900) errors.push('environment.timeout_seconds must be from 1 through 900');
  }
  for (const phase of ['failure', 'fixed']) {
    const step = value.steps?.[phase];
    if (!object(step) || !Array.isArray(step.command) || step.command.length === 0 || step.command.some((item) => !string(item))) errors.push(`steps.${phase}.command must be a non-empty string array`);
    if (!object(step?.expect) || !Array.isArray(step.expect.exit_codes) || step.expect.exit_codes.some((item) => !Number.isInteger(item))) errors.push(`steps.${phase}.expect.exit_codes must be an integer array`);
    if (!string(step?.expect?.stdout_matches) && !string(step?.expect?.stderr_matches)) errors.push(`steps.${phase}.expect must declare a stdout or stderr signature`);
  }
  if (!object(value.fixture) || !string(value.fixture.path) || !digest(value.fixture.sha256)) errors.push('fixture.path and fixture.sha256 are required');
  if (value.source_assertions !== undefined) {
    if (!Array.isArray(value.source_assertions) || value.source_assertions.length === 0) errors.push('source_assertions must be a non-empty array');
    else for (const [index, assertion] of value.source_assertions.entries()) {
      if (!object(assertion) || !string(assertion.path) || path.isAbsolute(assertion.path) || assertion.path.split(/[\\/]/).includes('..')) errors.push(`source_assertions.${index}.path must be a safe repository-relative path`);
      if (!/^[a-f0-9]{40}$/i.test(assertion?.failure_blob || '') || !/^[a-f0-9]{40}$/i.test(assertion?.fixed_blob || '')) errors.push(`source_assertions.${index} blob IDs must be 40-character Git object IDs`);
      if (assertion?.failure_blob === assertion?.fixed_blob) errors.push(`source_assertions.${index} must prove a changed source object`);
    }
  }
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateReproductionReceipt(value, caseRecord, definition, file = 'reproduction-receipt.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0' || value.case_id !== caseRecord.id) errors.push('receipt identity is invalid');
  if (!['reproduced', 'not-reproduced', 'error'].includes(value.status)) errors.push('receipt status is unsupported');
  if (!digest(value.definition_sha256) || !digest(value.fixture_sha256) || !digest(value.environment_fingerprint)) errors.push('receipt digests are required');
  if (value.fixture_sha256 !== definition.fixture.sha256) errors.push('receipt fixture digest does not match definition');
  if (!object(value.phases) || !object(value.phases.failure) || !object(value.phases.fixed)) errors.push('failure and fixed phase receipts are required');
  if (definition.source_assertions?.length && value.source_validation?.status !== 'verified') errors.push('source revision assertions must be verified for retained reproduced evidence');
  if (!Number.isFinite(value.duration_ms) || value.duration_ms < 0) errors.push('duration_ms must be non-negative');
  timestamp(value.executed_at, 'receipt.executed_at', errors);
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateMinimizationReceipt(value, caseRecord, file = 'minimization.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0' || value.case_id !== caseRecord.id) errors.push('minimization identity is invalid');
  if (!['preserved', 'not-preserved'].includes(value.status)) errors.push('minimization status is unsupported');
  for (const key of ['original_signature', 'minimized_signature', 'rationale']) required(value, key, 'minimization', errors);
  if (!digest(value.fixture_sha256)) errors.push('minimization.fixture_sha256 must be SHA-256');
  if (value.status === 'preserved' && value.original_signature !== value.minimized_signature) errors.push('preserved minimization signatures must match');
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateTaskMapping(value, caseRecord, file = 'task-mapping.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (!PROMOTION_TRACKS.has(value.track)) errors.push('task mapping track is unsupported');
  required(value, 'task_id', 'task_mapping', errors);
  if (!digest(value.source_evidence_digest) || value.source_evidence_digest !== caseRecord._meta?.evidenceIdentity) errors.push('task mapping source evidence digest is invalid');
  if (caseRecord.stratum === 'agent-harness' && value.track !== 'harness-regression') errors.push('Agent Harness cases must use harness-regression');
  if (caseRecord.stratum === 'agent-behavior' && value.track === 'harness-regression') errors.push('Agent behavior cases cannot use harness-regression');
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateCalibrationEvidence(value, caseRecord, mapping, file = 'calibration.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0' || value.case_id !== caseRecord.id) errors.push('calibration identity is invalid');
  if (!mapping || value.task_id !== mapping.task_id) errors.push('calibration task_id must match task mapping');
  if (!object(value.dataset) || !string(value.dataset.id) || !string(value.dataset.version)) errors.push('calibration dataset identity is required');
  if (!digest(value.dataset_digest)) errors.push('calibration.dataset_digest must be SHA-256');
  if (!['pass', 'fail'].includes(value.gate)) errors.push('calibration.gate is unsupported');
  if (!Number.isInteger(value.control_count) || value.control_count < 5) errors.push('calibration.control_count must be at least five');
  for (const key of ['positive_false_negatives', 'negative_false_positives', 'execution_errors']) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`calibration.${key} must be a non-negative integer`);
  }
  if (value.isolated_workspaces !== true) errors.push('calibration controls must use isolated workspaces');
  if (!Array.isArray(value.controls) || value.controls.length !== value.control_count) errors.push('calibration.controls must match control_count');
  else {
    const positives = value.controls.filter((item) => item?.kind === 'positive');
    const negatives = value.controls.filter((item) => item?.kind === 'negative');
    if (positives.length < 2) errors.push('calibration requires at least two positive controls');
    if (negatives.length < 3) errors.push('calibration requires at least three negative controls');
    if (value.controls.some((item) => item?.correct !== true || item?.execution_status !== 'completed' || item?.oracle_mutated_workspace !== false)) errors.push('every calibration control must complete correctly without Oracle mutation');
  }
  if (value.gate === 'pass' && (value.positive_false_negatives !== 0 || value.negative_false_positives !== 0 || value.execution_errors !== 0)) errors.push('passing calibration must have zero control errors');
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

export function validateFailureCase(value, file = 'case.json') {
  const errors = [];
  if (!object(value)) throw new FailureCaseContractError(file, ['document must be an object']);
  if (value.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  for (const key of ['id', 'title', 'category', 'root_cause_family', 'source_project', 'observed_failure', 'expected_behavior']) required(value, key, 'case', errors);
  if (!/^rf-[a-z0-9][a-z0-9-]*$/.test(value.id || '')) errors.push('case.id must use rf- kebab-case');
  semver(value.version, 'case.version', errors);
  if (!STRATA.has(value.stratum)) errors.push('case.stratum is unsupported');
  if (!object(value.construct) || !string(value.construct.primary) || !Array.isArray(value.construct.tags) || value.construct.tags.length === 0 || value.construct.tags.some((item) => !string(item))) errors.push('construct.primary and non-empty construct.tags are required');
  if (!object(value.author) || !string(value.author.id) || !string(value.author.type)) errors.push('author.id and author.type are required');
  const source = value.source;
  if (!object(source) || !SOURCE_KINDS.has(source.kind)) errors.push('source.kind is unsupported');
  else {
    for (const key of ['canonical_locator', 'allowed_use', 'license_or_consent', 'privacy_classification', 'redaction_status']) required(source, key, 'source', errors);
    timestamp(source.retrieved_at, 'source.retrieved_at', errors);
    if (!/^https:\/\//i.test(source.canonical_locator) && source.kind !== 'evaluation-trace' && source.kind !== 'authorized-incident') errors.push('public source canonical_locator must use HTTPS');
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) errors.push('evidence must be a non-empty array');
  else {
    const ids = new Set();
    for (const [index, item] of value.evidence.entries()) {
      if (!object(item)) { errors.push(`evidence.${index} must be an object`); continue; }
      for (const key of ['id', 'type', 'locator', 'claim', 'availability']) required(item, key, `evidence.${index}`, errors);
      timestamp(item.retrieved_at, `evidence.${index}.retrieved_at`, errors);
      if (item.sha256 !== undefined && !digest(item.sha256)) errors.push(`evidence.${index}.sha256 must be SHA-256`);
      if (ids.has(item.id)) errors.push('evidence IDs must be unique');
      ids.add(item.id);
    }
  }
  if (!object(value.triage) || !TRIAGE_DECISIONS.has(value.triage.decision) || !Array.isArray(value.triage.reason_codes)) errors.push('triage decision and reason_codes are required');
  if (value.stratum === 'product-defect' && value.triage?.decision === 'accepted') errors.push('ordinary product defects cannot be accepted into the Agent failure count');
  if (value.reproduction !== null && value.reproduction !== undefined) {
    if (!object(value.reproduction)) errors.push('reproduction must be an object or null');
    else {
      required(value.reproduction, 'definition_path', 'reproduction', errors);
      if (value.reproduction.receipt_path !== null && value.reproduction.receipt_path !== undefined && !string(value.reproduction.receipt_path)) errors.push('reproduction.receipt_path must be a path or null');
    }
  }
  for (const field of ['minimization', 'task_mapping']) {
    if (value[field] !== null && value[field] !== undefined && !object(value[field])) errors.push(`${field} must be an object or null`);
  }
  if (!Array.isArray(value.reviews)) errors.push('reviews must be an array');
  else for (const [index, review] of value.reviews.entries()) {
    if (!object(review) || !string(review.reviewer_id) || !REVIEW_ROLES.has(review.role) || review.decision !== 'approved') errors.push(`reviews.${index} is invalid`);
    if (review?.reviewer_id === value.author?.id) errors.push(`reviews.${index} must be independent from author`);
  }
  if (Object.hasOwn(value, 'state') || Object.hasOwn(value, 'accepted')) errors.push('state and accepted must be derived, not authored');
  if (errors.length) throw new FailureCaseContractError(file, errors);
  return value;
}

async function optionalJson(directory, relative, label, options = {}) {
  if (!relative) return null;
  const file = safeDatasetPath(directory, relative, label);
  try {
    return { file, value: JSON.parse(await fsp.readFile(file, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT' && options.allowMissing) return null;
    throw error;
  }
}

export function deriveFailureCaseState(caseRecord, artifacts = {}) {
  const blockers = [];
  if (caseRecord.triage.decision === 'rejected') return { state: 'rejected', accepted: false, blockers: [...caseRecord.triage.reason_codes] };
  if (caseRecord.triage.decision !== 'accepted') blockers.push('triage-not-accepted');
  if (!caseRecord.evidence.length) blockers.push('primary-evidence-missing');
  let state = 'discovered';
  if (!blockers.includes('triage-not-accepted')) state = 'triaged';
  if (artifacts.reproduction?.status === 'reproduced') state = 'reproduced';
  else if (caseRecord.reproduction) blockers.push('reproduction-not-established');
  if (state === 'reproduced' && artifacts.minimization?.status === 'preserved') state = 'minimized';
  else if (state === 'reproduced' && caseRecord.minimization) blockers.push('minimization-not-established');
  if (state === 'minimized' && caseRecord.task_mapping?.task_id) state = 'task-ready';
  if (state === 'task-ready' && artifacts.calibration?.gate === 'pass') state = 'calibrated';
  else if (state === 'task-ready') blockers.push('calibration-not-passed');
  const reviewRoles = new Set(caseRecord.reviews.map((item) => item.role));
  const reviewed = reviewRoles.has('domain') && reviewRoles.has('evaluation');
  if (state === 'calibrated' && reviewed) state = 'reviewed';
  else if (state === 'calibrated') blockers.push('independent-review-not-established');
  if (state === 'reviewed' && artifacts.pilot?.ready === true) state = 'piloted';
  else if (state === 'reviewed') blockers.push('cross-agent-pilot-not-established');
  if (state === 'piloted' && caseRecord.task_mapping?.hidden_oracle_digest) state = 'release-eligible';
  else if (state === 'piloted') blockers.push('hidden-holdout-not-established');
  return { state, accepted: caseRecord.triage.decision === 'accepted' && caseRecord.stratum !== 'product-defect', blockers: [...new Set(blockers)].sort() };
}

export async function loadFailureCorpus(root) {
  const corpusRoot = path.resolve(root);
  const manifestFile = path.join(corpusRoot, 'registry.json');
  const manifest = validateFailureRegistry(JSON.parse(await fsp.readFile(manifestFile, 'utf8')), manifestFile);
  const cases = [];
  const identifiers = new Set();
  for (const relative of [...manifest.cases].sort()) {
    const file = safeDatasetPath(corpusRoot, relative, 'case path');
    const record = validateFailureCase(JSON.parse(await fsp.readFile(file, 'utf8')), file);
    const identity = `${record.id}@${record.version}`;
    if (identifiers.has(identity)) throw new FailureCaseContractError(file, [`duplicate case ${identity}`]);
    identifiers.add(identity);
    const directory = path.dirname(file);
    const reproductionDefinition = await optionalJson(directory, record.reproduction?.definition_path, 'reproduction definition');
    if (reproductionDefinition) validateReproductionDefinition(reproductionDefinition.value, record, reproductionDefinition.file);
    const reproductionReceipt = await optionalJson(directory, record.reproduction?.receipt_path, 'reproduction receipt', { allowMissing: true });
    if (reproductionReceipt) validateReproductionReceipt(reproductionReceipt.value, record, reproductionDefinition?.value, reproductionReceipt.file);
    const minimizationReceipt = await optionalJson(directory, record.minimization?.receipt_path, 'minimization receipt', { allowMissing: true });
    if (minimizationReceipt) validateMinimizationReceipt(minimizationReceipt.value, record, minimizationReceipt.file);
    const taskMapping = await optionalJson(directory, record.task_mapping?.mapping_path, 'task mapping', { allowMissing: true });
    const calibration = await optionalJson(directory, record.task_mapping?.calibration_path, 'calibration evidence', { allowMissing: true });
    const pilot = await optionalJson(directory, record.pilot?.evidence_path, 'pilot evidence', { allowMissing: true });
    const evidenceIdentity = sha256(canonicalJson(record.evidence.map((item) => ({ type: item.type, locator: item.locator, revision: item.revision || null, sha256: item.sha256 || null })).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)))));
    const enriched = { ...record, _meta: { file, directory, reproductionDefinition, reproductionReceipt, minimizationReceipt, taskMapping, calibration, pilot, evidenceIdentity } };
    if (taskMapping) validateTaskMapping(taskMapping.value, enriched, taskMapping.file);
    if (calibration) validateCalibrationEvidence(calibration.value, enriched, taskMapping?.value, calibration.file);
    cases.push(enriched);
  }
  return { root: corpusRoot, manifestFile, manifest, cases };
}
