import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { hashObject, readJson, writeJson } from '../lib/json.mjs';
import { assertWithin } from '../lib/paths.mjs';
import { runProcess } from '../lib/process.mjs';
import {
  SNAPSHOT_MANIFEST_SCHEMA_VERSION,
  SOURCE_RECORD_SCHEMA_VERSION,
  validateSnapshotManifest,
  validateSourceRecord,
} from './source-record.mjs';

export const EXCLUSION_POLICY_VERSION = '1.0';

export const DEFAULT_SOURCE_LIMITS = Object.freeze({
  maxFiles: 50_000,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxFileBytes: 100 * 1024 * 1024,
  maxRelativePathLength: 512,
  cloneTimeoutMs: 5 * 60 * 1000,
  cloneOutputLimit: 2 * 1024 * 1024,
});

export const DEFAULT_EXCLUSIONS = Object.freeze({
  version: EXCLUSION_POLICY_VERSION,
  names: ['.git', 'node_modules', '.moss-eval', '.venv', 'venv', '__pycache__', '.cache'],
  secretPatterns: ['.env', '.env.*', '*.pem', '*.key', 'credentials.json'],
});

export class SourceIngestionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SourceIngestionError';
    this.code = code;
    this.details = details;
  }
}

export async function renameDirectoryWithRetry(source, destination, options = {}) {
  const rename = options.rename || fsp.rename;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const delays = options.delays || [25, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const retryable = ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!retryable || attempt >= delays.length) throw error;
      await sleep(delays[attempt]);
    }
  }
}

function wildcardPattern(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*').replaceAll('?', '.')} $`.replace(' $', '$'), 'i');
}

function normalizedRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function exclusionReason(relativePath, entryName, exclusions) {
  if (exclusions.names.includes(entryName)) return `excluded-name:${entryName}`;
  const normalized = normalizedRelative(relativePath);
  for (const pattern of exclusions.secretPatterns) {
    if (wildcardPattern(pattern).test(entryName) || wildcardPattern(pattern).test(normalized)) {
      return `secret-pattern:${pattern}`;
    }
  }
  return null;
}

function mergedOptions(options) {
  return {
    limits: { ...DEFAULT_SOURCE_LIMITS, ...(options.limits || {}) },
    exclusions: {
      version: options.exclusions?.version || DEFAULT_EXCLUSIONS.version,
      names: [...new Set([...(DEFAULT_EXCLUSIONS.names || []), ...(options.exclusions?.names || [])])],
      secretPatterns: [...new Set([
        ...(DEFAULT_EXCLUSIONS.secretPatterns || []),
        ...(options.exclusions?.secretPatterns || []),
      ])],
    },
  };
}

async function copyAndHashFile(source, destination, state, limits) {
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limits.maxFileBytes) {
        callback(new SourceIngestionError('SOURCE_FILE_TOO_LARGE', `File exceeds ${limits.maxFileBytes} bytes: ${source}`));
        return;
      }
      if (state.totalBytes + bytes > limits.maxTotalBytes) {
        callback(new SourceIngestionError('SOURCE_TOTAL_TOO_LARGE', `Source exceeds ${limits.maxTotalBytes} bytes`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await pipeline(createReadStream(source), meter, createWriteStream(destination, { flags: 'wx' }));
  state.totalBytes += bytes;
  return { size: bytes, sha256: hash.digest('hex') };
}

async function snapshotTree(sourceRoot, destinationRoot, options) {
  const { limits, exclusions } = mergedOptions(options);
  const files = [];
  const warnings = [];
  const state = { totalBytes: 0, fileCount: 0 };

  async function walk(currentSource, currentDestination) {
    const entries = await fsp.readdir(currentSource, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name);
      const relative = path.relative(sourceRoot, sourcePath);
      const normalized = normalizedRelative(relative);
      if (normalized.length > limits.maxRelativePathLength) {
        throw new SourceIngestionError('SOURCE_PATH_TOO_LONG', `Source path exceeds ${limits.maxRelativePathLength} characters: ${normalized}`);
      }
      const reason = exclusionReason(relative, entry.name, exclusions);
      if (reason) {
        warnings.push({ path: normalized, action: 'excluded', reason });
        continue;
      }
      if (entry.isSymbolicLink()) {
        warnings.push({ path: normalized, action: 'excluded', reason: 'symbolic-link-or-junction' });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(sourcePath, path.join(currentDestination, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        warnings.push({ path: normalized, action: 'excluded', reason: 'unsupported-file-type' });
        continue;
      }
      state.fileCount += 1;
      if (state.fileCount > limits.maxFiles) {
        throw new SourceIngestionError('SOURCE_FILE_COUNT_EXCEEDED', `Source exceeds ${limits.maxFiles} files`);
      }
      const stat = await fsp.stat(sourcePath);
      if (stat.size > limits.maxFileBytes) {
        throw new SourceIngestionError('SOURCE_FILE_TOO_LARGE', `File exceeds ${limits.maxFileBytes} bytes: ${normalized}`);
      }
      const copied = await copyAndHashFile(
        sourcePath,
        path.join(currentDestination, entry.name),
        state,
        limits,
      );
      files.push({ path: normalized, ...copied });
    }
  }

  await walk(sourceRoot, destinationRoot);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const fingerprint = hashObject({
    schema_version: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    files,
    exclusions: {
      version: exclusions.version,
      names: [...exclusions.names].sort(),
      secret_patterns: [...exclusions.secretPatterns].sort(),
    },
  });
  return {
    fingerprint,
    files,
    fileCount: state.fileCount,
    totalBytes: state.totalBytes,
    warnings,
    limits,
    exclusions,
  };
}

async function gitOutput(args, options = {}) {
  const result = await (options.processRunner || runProcess)({
    command: 'git',
    args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs || 30_000,
    outputLimit: options.outputLimit || 2 * 1024 * 1024,
  });
  if (result.startError || result.timedOut || result.exitCode !== 0) {
    const error = new Error(result.startError?.message || result.stderr || result.stdout || `git exited ${result.exitCode}`);
    error.code = result.startError?.code || (result.timedOut ? 'GIT_TIMEOUT' : 'GIT_FAILED');
    throw error;
  }
  return result.stdout.trim();
}

export async function inspectLocalGit(sourceRoot, options = {}) {
  let topLevel;
  let commit;
  try {
    topLevel = await gitOutput(['-C', sourceRoot, 'rev-parse', '--show-toplevel'], options);
    commit = await gitOutput(['-C', sourceRoot, 'rev-parse', 'HEAD'], options);
  } catch (error) {
    if (['ENOENT', 'GIT_FAILED'].includes(error.code)) return null;
    throw error;
  }
  let branch = null;
  try {
    branch = await gitOutput(['-C', sourceRoot, 'branch', '--show-current'], options) || null;
  } catch (error) {
    if (!['ENOENT', 'GIT_FAILED'].includes(error.code)) throw error;
  }
  const status = await gitOutput(
    ['-C', sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
    options,
  );
  return {
    repository_root: path.resolve(topLevel),
    commit: /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null,
    branch,
    dirty: Boolean(status),
    changed_entry_count: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
  };
}

async function snapshotStorageDirectories(sourcesRoot) {
  const root = path.resolve(sourcesRoot);
  const directories = {
    root,
    snapshots: path.join(root, 'snapshots'),
    records: path.join(root, 'records'),
    staging: path.join(root, '.staging'),
  };
  for (const directory of Object.values(directories)) await fsp.mkdir(directory, { recursive: true });
  return directories;
}

export async function ingestLocalSource(sourceDirectory, options = {}) {
  if (!options.sourcesRoot) throw new Error('sourcesRoot is required');
  const sourceRoot = path.resolve(sourceDirectory);
  const stat = await fsp.stat(sourceRoot).catch((error) => {
    throw new SourceIngestionError('SOURCE_UNREADABLE', `Unable to read source directory: ${error.message}`);
  });
  if (!stat.isDirectory()) throw new SourceIngestionError('SOURCE_NOT_DIRECTORY', `Source is not a directory: ${sourceRoot}`);
  const storage = await snapshotStorageDirectories(options.sourcesRoot);
  const storageRelative = path.relative(sourceRoot, storage.root);
  if (storageRelative === '' || (!storageRelative.startsWith('..' + path.sep) && !path.isAbsolute(storageRelative))) {
    throw new SourceIngestionError('SOURCE_CONTAINS_STORAGE_ROOT', 'Evaluator source storage must not be inside the selected source directory');
  }

  const stagingRoot = assertWithin(storage.staging, path.join(storage.staging, randomUUID()), 'staging path');
  const stagingContent = path.join(stagingRoot, 'content');
  await fsp.mkdir(stagingContent, { recursive: true });
  try {
    const snapshot = await snapshotTree(sourceRoot, stagingContent, options);
    const finalRoot = assertWithin(storage.snapshots, path.join(storage.snapshots, snapshot.fingerprint), 'snapshot path');
    const finalContent = path.join(finalRoot, 'content');
    const createdAt = new Date().toISOString();
    const manifest = validateSnapshotManifest({
      schema_version: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
      fingerprint: snapshot.fingerprint,
      created_at: createdAt,
      file_count: snapshot.fileCount,
      total_bytes: snapshot.totalBytes,
      files: snapshot.files,
      exclusions: {
        version: snapshot.exclusions.version,
        names: snapshot.exclusions.names,
        secret_patterns: snapshot.exclusions.secretPatterns,
      },
      limits: snapshot.limits,
      immutable: true,
    });

    let reused = false;
    let effectiveManifest = manifest;
    try {
      const existing = validateSnapshotManifest(await readJson(path.join(finalRoot, 'snapshot-manifest.json')));
      if (existing.fingerprint !== snapshot.fingerprint) {
        throw new SourceIngestionError('SNAPSHOT_CACHE_CORRUPT', `Snapshot cache fingerprint mismatch: ${finalRoot}`);
      }
      effectiveManifest = existing;
      reused = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeJson(path.join(stagingRoot, 'snapshot-manifest.json'), manifest);
      await fsp.mkdir(path.dirname(finalRoot), { recursive: true });
      try {
        await renameDirectoryWithRetry(stagingRoot, finalRoot);
      } catch (renameError) {
        if (renameError.code !== 'EEXIST' && renameError.code !== 'ENOTEMPTY') throw renameError;
        reused = true;
      }
    }

    const git = options.git === undefined
      ? await inspectLocalGit(sourceRoot, options)
      : options.git;
    const type = options.type || 'local';
    const canonicalLocation = options.canonicalLocation || sourceRoot;
    const recordIdentity = hashObject({
      type,
      canonical_location: canonicalLocation,
      revision: options.revision || null,
      snapshot_fingerprint: snapshot.fingerprint,
    }).slice(0, 12);
    const record = validateSourceRecord({
      schema_version: SOURCE_RECORD_SCHEMA_VERSION,
      id: `source-${snapshot.fingerprint.slice(0, 16)}-${recordIdentity}`,
      type,
      original_input: options.originalInput || sourceDirectory,
      canonical_location: canonicalLocation,
      revision: options.revision || null,
      requested_ref: options.requestedRef || null,
      snapshot_fingerprint: snapshot.fingerprint,
      snapshot_path: finalContent,
      created_at: createdAt,
      git,
      snapshot: effectiveManifest,
      exclusions: effectiveManifest.exclusions,
      warnings: snapshot.warnings,
      reused_snapshot: reused,
    });
    await writeJson(path.join(storage.records, `${record.id}.json`), record);
    return record;
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true });
  }
}

export function normalizeGitHubUrl(input) {
  let value = String(input || '').trim();
  if (/^github\.com\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SourceIngestionError('UNSUPPORTED_SOURCE_URL', 'Expected a public GitHub repository URL such as https://github.com/owner/repository');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password) {
    throw new SourceIngestionError('UNSUPPORTED_SOURCE_URL', 'Only credential-free https://github.com repository URLs are supported');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new SourceIngestionError('UNSUPPORTED_SOURCE_URL', 'GitHub URL must identify a repository root; select a branch or tag separately');
  }
  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new SourceIngestionError('UNSUPPORTED_SOURCE_URL', 'GitHub owner or repository name contains unsupported characters');
  }
  return {
    owner,
    repository,
    canonicalUrl: `https://github.com/${owner}/${repository}.git`,
  };
}

export async function resolveGitHubCommit(repositoryUrl, ref = null, options = {}) {
  if (ref && /^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  if (!ref || ref === 'HEAD') {
    const output = await gitOutput(['ls-remote', '--symref', repositoryUrl, 'HEAD'], options);
    const commit = output.split(/\r?\n/)
      .map((line) => line.match(/^([0-9a-f]{40})\s+HEAD$/i)?.[1])
      .find(Boolean);
    if (commit) return commit.toLowerCase();
  } else {
    for (const candidate of [ref, `refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`]) {
      const output = await gitOutput(['ls-remote', repositoryUrl, candidate], options);
      const commit = output.split(/\r?\n/)
        .map((line) => line.match(/^([0-9a-f]{40})\s+/i)?.[1])
        .find(Boolean);
      if (commit) return commit.toLowerCase();
    }
  }
  throw new SourceIngestionError('GITHUB_REF_NOT_FOUND', `Unable to resolve ${ref || 'HEAD'} at ${repositoryUrl}`);
}

async function runGitChecked(args, options) {
  return gitOutput(args, {
    ...options,
    timeoutMs: options.limits.cloneTimeoutMs,
    outputLimit: options.limits.cloneOutputLimit,
  });
}

export async function gitSupportsPartialClone(options = {}) {
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...(options.limits || {}) };
  const output = await gitOutput(['--version'], {
    ...options,
    timeoutMs: limits.cloneTimeoutMs,
    outputLimit: limits.cloneOutputLimit,
  });
  const match = output.match(/git version (\d+)\.(\d+)/i);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 19);
}

export async function ingestGitHubSource(input, options = {}) {
  if (!options.sourcesRoot) throw new Error('sourcesRoot is required');
  const normalized = normalizeGitHubUrl(input);
  const merged = mergedOptions(options);
  const commit = await resolveGitHubCommit(normalized.canonicalUrl, options.ref || null, {
    ...options,
    ...merged,
  });
  const cloneParent = path.resolve(options.cloneRoot || path.join(options.sourcesRoot, '.clones'));
  await fsp.mkdir(cloneParent, { recursive: true });
  const checkout = assertWithin(cloneParent, path.join(cloneParent, randomUUID()), 'clone path');
  try {
    await runGitChecked(['init', checkout], { ...options, ...merged });
    await runGitChecked(['-C', checkout, 'remote', 'add', 'origin', normalized.canonicalUrl], { ...options, ...merged });
    const fetchArgs = ['-C', checkout, '-c', 'protocol.file.allow=never', 'fetch', '--depth', '1'];
    if (await gitSupportsPartialClone({ ...options, ...merged })) fetchArgs.push('--filter=blob:none');
    fetchArgs.push('origin', commit);
    await runGitChecked(fetchArgs, { ...options, ...merged });
    await runGitChecked(['-C', checkout, 'checkout', '--detach', 'FETCH_HEAD'], { ...options, ...merged });
    const actual = await runGitChecked(['-C', checkout, 'rev-parse', 'HEAD'], { ...options, ...merged });
    if (actual.toLowerCase() !== commit) {
      throw new SourceIngestionError('GITHUB_CHECKOUT_MISMATCH', `Checked out ${actual}, expected ${commit}`);
    }
    return await ingestLocalSource(checkout, {
      ...options,
      ...merged,
      type: 'github',
      originalInput: input,
      canonicalLocation: normalized.canonicalUrl,
      revision: commit,
      requestedRef: options.ref || 'HEAD',
      git: { repository_root: checkout, commit, branch: null, dirty: false, changed_entry_count: 0 },
    });
  } finally {
    await fsp.rm(checkout, { recursive: true, force: true });
  }
}

export async function listSourceSnapshots(sourcesRoot) {
  const snapshotsRoot = path.join(path.resolve(sourcesRoot), 'snapshots');
  let entries;
  try {
    entries = await fsp.readdir(snapshotsRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const snapshots = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      snapshots.push(validateSnapshotManifest(await readJson(path.join(snapshotsRoot, entry.name, 'snapshot-manifest.json'))));
    } catch (error) {
      snapshots.push({ fingerprint: entry.name, invalid: true, error: error.message, created_at: null });
    }
  }
  return snapshots.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

export async function planSourceRetention(sourcesRoot, options = {}) {
  const keep = Number.isInteger(options.keep) ? Math.max(0, options.keep) : 20;
  const snapshots = await listSourceSnapshots(sourcesRoot);
  return {
    keep: snapshots.slice(0, keep),
    candidates: snapshots.slice(keep),
    generated_at: new Date().toISOString(),
    host: os.hostname(),
  };
}
