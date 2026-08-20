import fsp from 'node:fs/promises';
import path from 'node:path';

import { hashObject, readJson, writeJson } from '../lib/json.mjs';
import { assertWithin } from '../lib/paths.mjs';

export const PREPARED_TARGET_SCHEMA_VERSION = '1.0';

export function validatePreparedTarget(target) {
  const errors = [];
  if (!target || typeof target !== 'object') throw new Error('Prepared target must be an object');
  if (target.schema_version !== PREPARED_TARGET_SCHEMA_VERSION) errors.push('unsupported schema_version');
  if (!/^[0-9a-f]{64}$/.test(target.target_fingerprint || '')) errors.push('target_fingerprint is invalid');
  if (!/^[0-9a-f]{64}$/.test(target.source?.fingerprint || '')) errors.push('source.fingerprint is invalid');
  if (target.adapter?.api_version !== '1.0') errors.push('adapter.api_version is incompatible');
  if (!/^[0-9a-f]{64}$/.test(target.adapter?.fingerprint || '')) errors.push('adapter.fingerprint is invalid');
  if (!/^sha256:[0-9a-f]{64}$/.test(target.image_digest || '')) errors.push('image_digest must be an immutable sha256 digest');
  if (!target.capabilities || typeof target.capabilities !== 'object') errors.push('capabilities are required');
  if (errors.length > 0) throw new Error(`Invalid prepared target:\n- ${errors.join('\n- ')}`);
  return target;
}

export function createPreparedTargetManifest(input) {
  const adapterFingerprint = input.adapter.fingerprint({
    sourceFingerprint: input.sourceRecord.snapshot_fingerprint,
    configuration: input.effectiveConfiguration || null,
    manifest: input.effectiveConfiguration || null,
  });
  const effectiveConfigurationHash = hashObject(input.effectiveConfiguration || {});
  const identity = {
    schema_version: PREPARED_TARGET_SCHEMA_VERSION,
    source: {
      id: input.sourceRecord.id,
      fingerprint: input.sourceRecord.snapshot_fingerprint,
      revision: input.sourceRecord.revision || null,
      canonical_location: input.sourceRecord.canonical_location,
    },
    adapter: {
      id: input.adapter.id,
      version: input.adapter.version,
      api_version: input.adapter.apiVersion,
      fingerprint: adapterFingerprint,
    },
    effective_configuration_hash: effectiveConfigurationHash,
    preparation: input.preparationPlan,
    launch: input.launch || null,
    sandbox_policy: input.sandboxPolicy,
    runtime: input.runtime,
    image_digest: String(input.imageDigest || '').toLowerCase(),
    configured_image: input.configuredImage || null,
    capabilities: input.capabilities,
    required_secrets: [...new Set(input.requiredSecrets || [])],
    runtime_network_required: Boolean(input.runtimeNetworkRequired),
    telemetry: {
      maximum_level: input.capabilities.telemetry_level || 'L0',
      adapter: input.adapter.id,
    },
  };
  return validatePreparedTarget({
    ...identity,
    target_fingerprint: hashObject(identity),
    created_at: new Date().toISOString(),
  });
}

export async function savePreparedTarget(target, targetsRoot) {
  validatePreparedTarget(target);
  const root = path.resolve(targetsRoot);
  const directory = assertWithin(root, path.join(root, target.target_fingerprint), 'prepared target path');
  const file = path.join(directory, 'prepared-target.json');
  try {
    const existing = validatePreparedTarget(await readJson(file));
    if (hashObject({ ...existing, created_at: null }) !== hashObject({ ...target, created_at: null })) {
      throw new Error(`Prepared target cache collision: ${target.target_fingerprint}`);
    }
    return { target: existing, file, reused: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fsp.mkdir(directory, { recursive: true });
  await writeJson(file, target);
  return { target, file, reused: false };
}

export async function loadPreparedTarget(file) {
  return validatePreparedTarget(await readJson(file));
}

export function createPreparedLaunch(adapter, context) {
  const preparedTarget = validatePreparedTarget(context.preparedTarget);
  const launch = adapter.createLaunch({ ...context, preparedTarget });
  if (launch.image !== preparedTarget.image_digest) {
    throw new Error('Adapter launch must use the prepared target immutable image digest');
  }
  return launch;
}
