import fsp from 'node:fs/promises';
import path from 'node:path';
import { safeDatasetPath } from './canonical.mjs';

const TRACKS = new Set([
  'adapter-conformance',
  'general-capability',
  'target-regression',
  'harness-regression',
  'private-business',
]);
const SOURCE_KINDS = new Set(['production-trace', 'issue', 'pull-request', 'incident', 'synthetic', 'research']);
const ORACLE_DISTRIBUTIONS = new Set(['public-development', 'hidden-external']);
const REVIEW_ROLES = new Set(['domain', 'evaluation']);

export class DatasetContractError extends Error {
  constructor(file, errors) {
    super('Invalid professional dataset artifact ' + file + ':\n- ' + errors.join('\n- '));
    this.name = 'DatasetContractError';
    this.file = file;
    this.errors = errors;
  }
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireString(parent, key, prefix, errors) {
  if (!object(parent) || !string(parent[key])) errors.push(prefix + '.' + key + ' is required');
}

function validateSemanticVersion(value, field, errors) {
  if (!string(value) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    errors.push(field + ' must be a semantic version');
  }
}

export function validateDatasetManifest(manifest, file = 'dataset.json') {
  const errors = [];
  if (!object(manifest)) throw new DatasetContractError(file, ['document must be an object']);
  if (manifest.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  requireString(manifest, 'id', 'dataset', errors);
  requireString(manifest, 'title', 'dataset', errors);
  validateSemanticVersion(manifest.version, 'dataset.version', errors);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0 || manifest.tasks.some((item) => !string(item))) {
    errors.push('dataset.tasks must be a non-empty array of paths');
  }
  const policy = manifest.policy;
  if (!object(policy)) errors.push('dataset.policy is required');
  else {
    for (const key of ['minimum_positive_controls', 'minimum_negative_controls', 'minimum_reviewers', 'minimum_agent_families', 'minimum_valid_observations_per_task', 'minimum_attempts']) {
      if (!Number.isInteger(policy[key]) || policy[key] < 1) errors.push('dataset.policy.' + key + ' must be a positive integer');
    }
    for (const key of ['minimum_difficulty', 'maximum_difficulty', 'minimum_discrimination', 'maximum_construct_concentration']) {
      if (!Number.isFinite(policy[key]) || policy[key] < 0 || policy[key] > 1) errors.push('dataset.policy.' + key + ' must be from 0 through 1');
    }
    if (policy.hidden_oracle_required !== true) errors.push('dataset.policy.hidden_oracle_required must be true');
  }
  if (errors.length) throw new DatasetContractError(file, errors);
  return manifest;
}

function validateReviews(card, errors) {
  if (!Array.isArray(card.reviews)) {
    errors.push('reviews must be an array');
    return;
  }
  const reviewers = new Set();
  for (const [index, review] of card.reviews.entries()) {
    if (!object(review)) {
      errors.push('reviews.' + index + ' must be an object');
      continue;
    }
    requireString(review, 'reviewer_id', 'reviews.' + index, errors);
    if (!REVIEW_ROLES.has(review.role)) errors.push('reviews.' + index + '.role must be domain or evaluation');
    if (review.decision !== 'approved') errors.push('reviews.' + index + '.decision must be approved');
    if (review.reviewer_id === card.author?.id) errors.push('reviews.' + index + ' reviewer must differ from author');
    if (reviewers.has(review.reviewer_id)) errors.push('reviewer IDs must be independent and unique');
    reviewers.add(review.reviewer_id);
  }
}

export function validateTaskCard(card, policy, file = 'task-card.json') {
  const errors = [];
  if (!object(card)) throw new DatasetContractError(file, ['document must be an object']);
  if (card.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  for (const key of ['id', 'title', 'category', 'instruction', 'runtime_task', 'runtime_task_sha256']) requireString(card, key, 'task', errors);
  validateSemanticVersion(card.version, 'task.version', errors);
  if (!TRACKS.has(card.track)) errors.push('track is unsupported');
  if (!object(card.construct) || !string(card.construct.primary) || !Array.isArray(card.construct.tags) || card.construct.tags.length === 0) {
    errors.push('construct.primary and non-empty construct.tags are required');
  }
  if (!object(card.author) || !string(card.author.id) || !string(card.author.type)) errors.push('author.id and author.type are required');
  if (!object(card.source) || !SOURCE_KINDS.has(card.source.kind)) errors.push('source.kind is unsupported');
  else {
    for (const key of ['reference', 'allowed_use', 'license_or_consent', 'redaction_status', 'construct_rationale']) {
      requireString(card.source, key, 'source', errors);
    }
  }
  if (!object(card.fixture)) errors.push('fixture is required');
  else for (const key of ['path', 'sha256', 'family']) requireString(card.fixture, key, 'fixture', errors);
  if (!object(card.oracle)) errors.push('oracle is required');
  else {
    for (const key of ['path', 'sha256']) requireString(card.oracle, key, 'oracle', errors);
    if (!ORACLE_DISTRIBUTIONS.has(card.oracle.distribution)) errors.push('oracle.distribution is unsupported');
    if (!Number.isFinite(card.oracle.timeout_seconds) || card.oracle.timeout_seconds <= 0) errors.push('oracle.timeout_seconds must be positive');
  }
  if (card.oracle_isolation !== 'evaluator-only') errors.push('oracle_isolation must be evaluator-only');
  if (!Array.isArray(card.alternate_paths) || card.alternate_paths.length < policy.minimum_positive_controls) {
    errors.push('alternate_paths must describe at least ' + policy.minimum_positive_controls + ' approaches');
  }
  if (!Array.isArray(card.controls)) errors.push('controls must be an array');
  else {
    const identifiers = new Set();
    for (const [index, control] of card.controls.entries()) {
      if (!object(control)) {
        errors.push('controls.' + index + ' must be an object');
        continue;
      }
      for (const key of ['id', 'path', 'sha256', 'description']) requireString(control, key, 'controls.' + index, errors);
      if (!['positive', 'negative'].includes(control.kind)) errors.push('controls.' + index + '.kind is unsupported');
      if (typeof control.expected_pass !== 'boolean') errors.push('controls.' + index + '.expected_pass must be boolean');
      if (control.kind === 'positive' && control.expected_pass !== true) errors.push('positive control must expect pass');
      if (control.kind === 'negative' && control.expected_pass !== false) errors.push('negative control must expect failure');
      if (identifiers.has(control.id)) errors.push('control IDs must be unique');
      identifiers.add(control.id);
    }
    const positives = card.controls.filter((item) => item.kind === 'positive').length;
    const negatives = card.controls.filter((item) => item.kind === 'negative').length;
    if (positives < policy.minimum_positive_controls) errors.push('insufficient positive controls');
    if (negatives < policy.minimum_negative_controls) errors.push('insufficient negative controls');
  }
  validateReviews(card, errors);
  if (!object(card.contamination) || !string(card.contamination.status) || !string(card.contamination.evidence)) errors.push('contamination status and evidence are required');
  if (!object(card.pilot) || !string(card.pilot.evidence_path) || !string(card.pilot.sha256) || !object(card.pilot.requirements)) errors.push('pilot evidence_path, sha256 and requirements are required');
  if (!object(card.budgets)) errors.push('budgets are required');
  if (Object.hasOwn(card, 'release_state')) errors.push('release_state must be derived, not authored');
  if (errors.length) throw new DatasetContractError(file, errors);
  return card;
}

export async function loadProfessionalDataset(root) {
  const datasetRoot = path.resolve(root);
  const manifestFile = path.join(datasetRoot, 'dataset.json');
  const manifest = validateDatasetManifest(JSON.parse(await fsp.readFile(manifestFile, 'utf8')), manifestFile);
  const cards = [];
  const identifiers = new Map();
  for (const relative of [...manifest.tasks].sort()) {
    const file = safeDatasetPath(datasetRoot, relative, 'task card');
    const card = validateTaskCard(JSON.parse(await fsp.readFile(file, 'utf8')), manifest.policy, file);
    const key = card.id + '@' + card.version;
    if (identifiers.has(key)) throw new DatasetContractError(file, ['duplicate task ' + key + ' also declared in ' + identifiers.get(key)]);
    identifiers.set(key, file);
    const directory = path.dirname(file);
    cards.push({
      ...card,
      _meta: {
        file,
        directory,
        runtimeTask: safeDatasetPath(directory, card.runtime_task, 'runtime task'),
        fixture: safeDatasetPath(directory, card.fixture.path, 'fixture'),
        oracle: safeDatasetPath(directory, card.oracle.path, 'oracle'),
        pilot: safeDatasetPath(directory, card.pilot.evidence_path, 'pilot evidence'),
        controls: Object.fromEntries(card.controls.map((control) => [control.id, safeDatasetPath(directory, control.path, 'control')])),
      },
    });
  }
  return { root: datasetRoot, manifestFile, manifest, cards };
}

export function independentReviewStatus(card, minimumReviewers = 2) {
  const approved = (card.reviews || []).filter((review) => review.decision === 'approved' && review.reviewer_id !== card.author.id);
  const reviewers = new Set(approved.map((review) => review.reviewer_id));
  const roles = new Set(approved.map((review) => review.role));
  return {
    ready: reviewers.size >= minimumReviewers && roles.has('domain') && roles.has('evaluation'),
    reviewer_count: reviewers.size,
    roles: [...roles].sort(),
  };
}

export function deriveTaskState(card, evidence = {}, policy = {}) {
  const blockers = [];
  if (!evidence.technical_passed) blockers.push('technical-audit-not-passed');
  if (!evidence.calibration_passed) blockers.push('task-specific-calibration-not-passed');
  const review = independentReviewStatus(card, policy.minimum_reviewers || 2);
  if (!review.ready) blockers.push('independent-human-review-not-established');
  if (card.oracle.distribution !== 'hidden-external') blockers.push('hidden-oracle-not-established');
  if (!evidence.pilot_ready) blockers.push('cross-agent-pilot-not-established');
  let state = 'candidate';
  if (evidence.technical_passed && evidence.calibration_passed) state = 'calibrated';
  if (state === 'calibrated' && review.ready) state = 'reviewed';
  if (state === 'reviewed' && evidence.pilot_ready) state = 'pilot';
  if (blockers.length === 0) state = 'release-eligible';
  return { state, release_eligible: state === 'release-eligible', blockers, review };
}
