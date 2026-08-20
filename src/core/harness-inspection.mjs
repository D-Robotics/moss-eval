import fsp from 'node:fs/promises';
import path from 'node:path';

import { hashObject, readJson, writeJson } from '../lib/json.mjs';
import { assertWithin, sanitizeId } from '../lib/paths.mjs';
import {
  INSPECTION_SCHEMA_VERSION,
  TARGET_PROFILE_SCHEMA_VERSION,
  HarnessManifestError,
  validateHarnessManifest,
  validateInspectionResult,
} from './harness-schema.mjs';

const MANIFEST_RELATIVE_PATH = '.moss-eval/harness.json';

async function readPackageJson(snapshotRoot, relativePath, evidence, warnings) {
  const file = assertWithin(snapshotRoot, path.join(snapshotRoot, ...relativePath.split('/')), 'inspection path');
  try {
    const packageJson = await readJson(file);
    evidence.push({ type: 'package-json', path: relativePath, name: packageJson.name || null });
    return packageJson;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    warnings.push({ code: 'INVALID_PACKAGE_JSON', path: relativePath, message: error.message });
    return null;
  }
}

export async function detectMossHarness(snapshotRoot) {
  const evidence = [];
  const warnings = [];
  let score = 0;
  const rootPackage = await readPackageJson(snapshotRoot, 'package.json', evidence, warnings);
  const agentPackage = await readPackageJson(snapshotRoot, 'packages/moss-agent/package.json', evidence, warnings);
  if (rootPackage?.name === 'moss-workspace') {
    score += 0.2;
    evidence.push({ type: 'moss-signature', path: 'package.json', field: 'name', value: 'moss-workspace', weight: 0.2 });
  }
  if ((rootPackage?.workspaces || []).includes('packages/moss-agent')) {
    score += 0.15;
    evidence.push({ type: 'moss-signature', path: 'package.json', field: 'workspaces', value: 'packages/moss-agent', weight: 0.15 });
  }
  if (agentPackage?.name === '@rdk-moss/agent') {
    score += 0.45;
    evidence.push({ type: 'moss-signature', path: 'packages/moss-agent/package.json', field: 'name', value: '@rdk-moss/agent', weight: 0.45 });
  }
  if (agentPackage?.bin?.moss) {
    score += 0.2;
    evidence.push({ type: 'moss-signature', path: 'packages/moss-agent/package.json', field: 'bin.moss', value: agentPackage.bin.moss, weight: 0.2 });
  }
  return {
    adapter: 'moss',
    adapter_api_version: '1.0',
    confidence: Math.min(1, score),
    confidence_label: score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low',
    version: agentPackage?.version || null,
    entry_points: agentPackage?.bin?.moss ? [{ path: `packages/moss-agent/${agentPackage.bin.moss}`, protocol: 'stream-json' }] : [],
    runtime_hints: rootPackage?.engines?.node ? { node: rootPackage.engines.node } : {},
    capabilities: {
      modes: ['one-shot', 'stream-json', 'pty', 'acp'],
      telemetry_level: 'L3',
      tools: [],
      tags: ['coding-repository', 'mcp', 'skills', 'subagents'],
    },
    evidence,
    warnings,
  };
}

export async function loadHarnessManifest(snapshotRoot) {
  const file = assertWithin(snapshotRoot, path.join(snapshotRoot, '.moss-eval', 'harness.json'), 'manifest path');
  try {
    return { file, manifest: validateHarnessManifest(await readJson(file), MANIFEST_RELATIVE_PATH), error: null };
  } catch (error) {
    if (error.code === 'ENOENT') return { file, manifest: null, error: null };
    if (error instanceof HarnessManifestError || error instanceof SyntaxError || /Invalid JSON/.test(error.message)) {
      return { file, manifest: null, error };
    }
    throw error;
  }
}

export async function inspectHarness(sourceRecord) {
  const snapshotRoot = path.resolve(sourceRecord.snapshot_path);
  const candidates = [];
  const evidence = [];
  const warnings = [];
  const manifestResult = await loadHarnessManifest(snapshotRoot);
  const moss = await detectMossHarness(snapshotRoot);
  evidence.push(...moss.evidence);
  warnings.push(...moss.warnings);
  if (moss.confidence >= 0.5) candidates.push(moss);

  let status = 'inconclusive';
  let manifest = null;
  if (manifestResult.error) {
    status = 'invalid_manifest';
    warnings.push({
      code: manifestResult.error.code || 'INVALID_HARNESS_MANIFEST',
      path: MANIFEST_RELATIVE_PATH,
      message: manifestResult.error.message,
      errors: manifestResult.error.errors || [],
    });
  } else if (manifestResult.manifest) {
    manifest = manifestResult.manifest;
    candidates.unshift({
      adapter: manifest.adapter.id,
      adapter_api_version: manifest.adapter.api_version,
      confidence: 1,
      confidence_label: 'explicit',
      entry_points: [{ path: manifest.launch.command, protocol: manifest.launch.protocol }],
      runtime_hints: { runtime: manifest.runtime },
      capabilities: manifest.capabilities,
      evidence: [{ type: 'harness-manifest', path: MANIFEST_RELATIVE_PATH }],
      warnings: [],
    });
    evidence.push({ type: 'harness-manifest', path: MANIFEST_RELATIVE_PATH, adapter: manifest.adapter.id });
    status = moss.confidence >= 0.5 && manifest.adapter.id !== 'moss' ? 'ambiguous' : 'manifest';
  } else if (moss.confidence >= 0.8) {
    status = 'detected';
  } else if (candidates.length > 1) {
    status = 'ambiguous';
  }

  return validateInspectionResult({
    schema_version: INSPECTION_SCHEMA_VERSION,
    source_fingerprint: sourceRecord.snapshot_fingerprint,
    inspected_at: new Date().toISOString(),
    snapshot_path: snapshotRoot,
    status,
    candidates,
    evidence,
    manifest,
    warnings,
    requires_confirmation: status !== 'manifest',
  });
}

export function createTargetProfile(input) {
  if (!input.confirmed) throw new Error('Guided target configuration requires explicit confirmation');
  if (!/^[0-9a-f]{64}$/.test(input.sourceFingerprint || '')) throw new Error('sourceFingerprint is invalid');
  const configuration = validateHarnessManifest(input.configuration, '<guided-profile>');
  const createdAt = new Date().toISOString();
  const fingerprint = hashObject(configuration);
  return {
    schema_version: TARGET_PROFILE_SCHEMA_VERSION,
    id: sanitizeId(`profile-${input.sourceFingerprint.slice(0, 16)}-${fingerprint.slice(0, 12)}`),
    source_fingerprint: input.sourceFingerprint,
    created_at: createdAt,
    confirmed_at: createdAt,
    configuration,
    configuration_fingerprint: fingerprint,
  };
}

export async function saveTargetProfile(profile, profilesRoot) {
  const directory = path.resolve(profilesRoot);
  await fsp.mkdir(directory, { recursive: true });
  const file = assertWithin(directory, path.join(directory, `${sanitizeId(profile.id)}.json`), 'profile path');
  await writeJson(file, profile);
  return file;
}

export async function loadTargetProfile(file, sourceFingerprint) {
  const profile = await readJson(file);
  if (profile.schema_version !== TARGET_PROFILE_SCHEMA_VERSION) throw new Error('Unsupported target profile schema_version');
  validateHarnessManifest(profile.configuration, file);
  if (hashObject(profile.configuration) !== profile.configuration_fingerprint) {
    throw new Error('Target profile configuration fingerprint mismatch');
  }
  return {
    profile,
    stale: profile.source_fingerprint !== sourceFingerprint,
    stale_reason: profile.source_fingerprint !== sourceFingerprint ? 'source_fingerprint_changed' : null,
  };
}
