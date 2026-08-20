import path from 'node:path';

export const HARNESS_MANIFEST_SCHEMA_VERSION = '1.0';
export const ADAPTER_API_VERSION = '1.0';
export const INSPECTION_SCHEMA_VERSION = '1.0';
export const TARGET_PROFILE_SCHEMA_VERSION = '1.0';
export const TELEMETRY_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3']);
export const HARNESS_MODES = Object.freeze(['one-shot', 'stream-json', 'pty', 'acp']);

function stringArray(value, name, errors, options = {}) {
  if (value === undefined && options.optional) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    errors.push(`${name} must be an array of non-empty strings`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${name} must not contain duplicates`);
}

function relativeRepositoryPath(value, name, errors) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || path.isAbsolute(value)) {
    errors.push(`${name} must be a relative repository path`);
    return;
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    errors.push(`${name} must not escape the source snapshot`);
  }
}

export class HarnessManifestError extends Error {
  constructor(errors, file = '.moss-eval/harness.json') {
    super(`Invalid Harness manifest in ${file}:\n- ${errors.join('\n- ')}`);
    this.name = 'HarnessManifestError';
    this.code = 'INVALID_HARNESS_MANIFEST';
    this.errors = errors;
    this.file = file;
  }
}

export function validateHarnessManifest(manifest, file = '.moss-eval/harness.json') {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new HarnessManifestError(['manifest must be an object'], file);
  }
  if (manifest.schema_version !== HARNESS_MANIFEST_SCHEMA_VERSION) {
    errors.push(`unsupported schema_version ${JSON.stringify(manifest.schema_version)}; expected ${HARNESS_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!manifest.adapter || typeof manifest.adapter !== 'object') {
    errors.push('adapter is required');
  } else {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(manifest.adapter.id || '')) errors.push('adapter.id is invalid');
    if (manifest.adapter.api_version !== ADAPTER_API_VERSION) {
      errors.push(`adapter.api_version must be ${ADAPTER_API_VERSION}`);
    }
  }
  if (!['node', 'python', 'container'].includes(manifest.runtime)) errors.push('runtime must be node, python, or container');
  if (!manifest.launch || typeof manifest.launch !== 'object') {
    errors.push('launch is required');
  } else {
    if (typeof manifest.launch.command !== 'string' || manifest.launch.command.length === 0) errors.push('launch.command is required');
    if (!HARNESS_MODES.includes(manifest.launch.protocol)) errors.push('launch.protocol is unsupported');
    stringArray(manifest.launch.args || [], 'launch.args', errors);
    relativeRepositoryPath(manifest.launch.command, 'launch.command', errors);
    relativeRepositoryPath(manifest.launch.working_directory, 'launch.working_directory', errors);
  }
  for (const [index, step] of (manifest.preparation?.steps || []).entries()) {
    if (!step || typeof step !== 'object') errors.push(`preparation.steps.${index} must be an object`);
    else {
      if (typeof step.command !== 'string' || step.command.length === 0) errors.push(`preparation.steps.${index}.command is required`);
      stringArray(step.args || [], `preparation.steps.${index}.args`, errors);
    }
  }
  relativeRepositoryPath(manifest.preparation?.working_directory, 'preparation.working_directory', errors);
  if (!manifest.capabilities || typeof manifest.capabilities !== 'object') {
    errors.push('capabilities are required');
  } else {
    stringArray(manifest.capabilities.modes, 'capabilities.modes', errors);
    for (const mode of manifest.capabilities.modes || []) {
      if (!HARNESS_MODES.includes(mode)) errors.push(`unsupported capability mode ${mode}`);
    }
    if (!TELEMETRY_LEVELS.includes(manifest.capabilities.telemetry_level)) {
      errors.push('capabilities.telemetry_level must be L0, L1, L2, or L3');
    }
    stringArray(manifest.capabilities.tools || [], 'capabilities.tools', errors);
    stringArray(manifest.capabilities.tags || [], 'capabilities.tags', errors);
  }
  for (const name of ['required', 'optional', 'secrets']) {
    stringArray(manifest.environment?.[name] || [], `environment.${name}`, errors);
  }
  stringArray(manifest.network?.allowed_hosts || [], 'network.allowed_hosts', errors);
  if (manifest.sandbox?.privileged === true) errors.push('sandbox.privileged is prohibited');
  if (manifest.sandbox?.docker_socket === true) errors.push('sandbox.docker_socket is prohibited');
  if ((manifest.sandbox?.host_mounts || []).length > 0) errors.push('sandbox.host_mounts are prohibited');
  if (errors.length > 0) throw new HarnessManifestError(errors, file);
  return structuredClone(manifest);
}

export function validateInspectionResult(result) {
  const statuses = ['detected', 'manifest', 'inconclusive', 'ambiguous', 'invalid_manifest'];
  if (result?.schema_version !== INSPECTION_SCHEMA_VERSION) throw new Error('Unsupported inspection schema_version');
  if (!/^[0-9a-f]{64}$/.test(result.source_fingerprint || '')) throw new Error('Inspection source_fingerprint is invalid');
  if (!statuses.includes(result.status)) throw new Error('Inspection status is invalid');
  if (!Array.isArray(result.candidates) || !Array.isArray(result.evidence) || !Array.isArray(result.warnings)) {
    throw new Error('Inspection candidates, evidence, and warnings must be arrays');
  }
  return result;
}
