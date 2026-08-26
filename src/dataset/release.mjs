import fsp from 'node:fs/promises';
import path from 'node:path';
import { auditProfessionalDataset } from './audit.mjs';
import { canonicalJson, directoryDigest, sha256 } from './canonical.mjs';

export async function buildProfessionalRelease(datasetRoot, options = {}) {
  const calibration = options.calibration || null;
  const pilot = options.pilot || null;
  const audited = await auditProfessionalDataset(datasetRoot, { calibration, pilot });
  const blockers = [...audited.report.blockers];
  if (audited.report.technical_gate !== 'pass') blockers.push('technical-dataset-gate-failed');
  if (!calibration || calibration.gate !== 'pass') blockers.push('task-specific-calibration-not-passed');
  if (calibration && calibration.dataset_digest !== audited.report.content_digest) blockers.push('calibration-content-digest-mismatch');
  const hiddenCards = audited.dataset.cards.filter((card) => card.oracle.distribution === 'hidden-external');
  if (hiddenCards.length !== audited.dataset.cards.length) blockers.push('all-tasks-require-hidden-external-oracles');
  let oracleBundleDigest = null;
  if (options.oracleBundle) {
    oracleBundleDigest = await directoryDigest(options.oracleBundle);
    const expected = audited.dataset.manifest.hidden_oracle_bundle_sha256;
    if (!expected || expected !== oracleBundleDigest) blockers.push('hidden-oracle-bundle-digest-mismatch');
  } else blockers.push('hidden-oracle-bundle-not-provided');
  const uniqueBlockers = [...new Set(blockers)].sort();
  const calibrationDigest = calibration ? sha256(canonicalJson(calibration)) : null;
  const pilotDigest = pilot ? sha256(canonicalJson(pilot)) : null;
  const result = {
    schema_version: '1.0',
    dataset: audited.report.dataset,
    dataset_digest: audited.report.content_digest,
    status: uniqueBlockers.length ? 'not-established' : 'release-eligible',
    release_eligible: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    hidden_oracle_bundle_sha256: oracleBundleDigest,
    calibration_evidence_sha256: calibrationDigest,
    pilot_evidence_sha256: pilotDigest,
    task_states: audited.report.tasks.map((task) => ({ task_id: task.task_id, state: task.state.state, blockers: task.state.blockers })),
  };
  if (!result.release_eligible) return { result, manifest: null };
  const unsigned = {
    schema_version: '1.0',
    dataset: result.dataset,
    dataset_digest: result.dataset_digest,
    hidden_oracle_bundle_sha256: oracleBundleDigest,
    calibration_evidence_sha256: calibrationDigest,
    pilot_evidence_sha256: pilotDigest,
    task_ids: audited.dataset.cards.map((card) => card.id).sort(),
    claim_policy: 'professional-scored',
  };
  const manifest = { ...unsigned, manifest_digest: sha256(canonicalJson(unsigned)) };
  if (options.output) {
    await fsp.mkdir(path.dirname(options.output), { recursive: true });
    await fsp.writeFile(options.output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  return { result, manifest };
}

export async function verifyReleaseManifest(manifest, datasetRoot, evidence = {}) {
  const rebuilt = await buildProfessionalRelease(datasetRoot, {
    calibration: evidence.calibration,
    pilot: evidence.pilot,
    oracleBundle: evidence.oracleBundle,
  });
  if (!rebuilt.manifest) return { valid: false, blockers: rebuilt.result.blockers };
  return {
    valid: rebuilt.manifest.manifest_digest === manifest.manifest_digest,
    blockers: rebuilt.manifest.manifest_digest === manifest.manifest_digest ? [] : ['release-manifest-content-drift'],
  };
}
