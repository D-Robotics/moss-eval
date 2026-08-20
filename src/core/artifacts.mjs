import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../lib/json.mjs';

export const ARTIFACT_SCHEMA_VERSION = '1.0';

export class ArtifactReadError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArtifactReadError';
    this.code = code;
    this.details = details;
  }
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function assertSupportedSchema(document, filePath, kind) {
  const version = document?.schema_version;
  if (version !== ARTIFACT_SCHEMA_VERSION) {
    throw new ArtifactReadError(
      'UNSUPPORTED_ARTIFACT_SCHEMA',
      `Unsupported ${kind} schema_version ${JSON.stringify(version)} in ${filePath}; supported version is ${ARTIFACT_SCHEMA_VERSION}`,
      { kind, file: filePath, found: version ?? null, supported: [ARTIFACT_SCHEMA_VERSION] },
    );
  }
  return document;
}

async function listDirectories(directory) {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function discoverCanonicalTrialFiles(runDirectory) {
  const trialsRoot = path.join(runDirectory, 'trials');
  const files = [];
  for (const taskEntry of await listDirectories(trialsRoot)) {
    const taskDirectory = path.join(trialsRoot, taskEntry.name);
    for (const agentEntry of await listDirectories(taskDirectory)) {
      const agentDirectory = path.join(taskDirectory, agentEntry.name);
      for (const trialEntry of await listDirectories(agentDirectory)) {
        if (!/^trial-[1-9][0-9]*$/.test(trialEntry.name)) continue;
        const trialFile = path.join(agentDirectory, trialEntry.name, 'trial.json');
        if (await exists(trialFile)) files.push(trialFile);
      }
    }
  }
  return files;
}

async function discoverLegacyTrialFiles(runDirectory) {
  const entries = await listDirectories(runDirectory);
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'trials') continue;
    const candidate = path.join(runDirectory, entry.name, 'trial.json');
    if (await exists(candidate)) files.push(candidate);
  }
  return files;
}

export async function readRunMetadata(runDirectory, options = {}) {
  const file = path.join(runDirectory, 'run.json');
  if (!(await exists(file))) {
    if (options.optional) return null;
    throw new ArtifactReadError('RUN_METADATA_MISSING', `Run metadata is missing: ${file}`, { file });
  }
  return assertSupportedSchema(await readJson(file), file, 'run');
}

export async function loadRunTrials(runDirectory, options = {}) {
  const files = await discoverCanonicalTrialFiles(runDirectory);
  if (files.length === 0) {
    const legacyFiles = await discoverLegacyTrialFiles(runDirectory);
    if (legacyFiles.length > 0) {
      throw new ArtifactReadError(
        'LEGACY_ARTIFACT_LAYOUT',
        `Legacy trial layout detected in ${runDirectory}; expected trials/<task>/<agent>/trial-<n>/trial.json`,
        { run_directory: runDirectory, legacy_files: legacyFiles },
      );
    }
  }
  const trials = [];
  for (const file of files) {
    const trial = assertSupportedSchema(await readJson(file), file, 'trial');
    if (!trial.task?.id || !trial.agent || !Number.isInteger(trial.replicate)) {
      throw new ArtifactReadError('INVALID_TRIAL_ARTIFACT', `Invalid trial identity in ${file}`, { file });
    }
    trials.push(trial);
  }
  if (options.withFiles) return trials.map((trial, index) => ({ trial, file: files[index] }));
  return trials;
}

export async function loadRunArtifacts(runDirectory) {
  const metadata = await readRunMetadata(runDirectory);
  const summaryFile = path.join(runDirectory, 'summary.json');
  const summary = (await exists(summaryFile))
    ? assertSupportedSchema(await readJson(summaryFile), summaryFile, 'summary')
    : null;
  const trials = await loadRunTrials(runDirectory);
  return {
    id: metadata.run_id,
    path: path.resolve(runDirectory),
    metadata,
    summary,
    trials,
  };
}
