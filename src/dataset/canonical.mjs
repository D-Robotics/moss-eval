import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const IGNORED_NAMES = new Set(['.git', 'node_modules', '.moss-eval']);

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeDatasetPath(root, candidate, label = 'dataset path') {
  if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) {
    throw new Error(label + ' must be a non-empty relative path');
  }
  const normalized = candidate.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '..' || part === '.git' || part === 'node_modules')) {
    throw new Error(label + ' contains a forbidden path segment');
  }
  const parent = path.resolve(root);
  const target = path.resolve(parent, ...normalized.split('/'));
  const relative = path.relative(parent, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(label + ' escapes the dataset root');
  }
  return target;
}

async function walk(root, current, output) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, absolute, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const content = await fsp.readFile(absolute);
    output.push({
      path: path.relative(root, absolute).split(path.sep).join('/'),
      size: content.length,
      sha256: sha256(content),
    });
  }
}

export async function directoryManifest(root) {
  const absolute = path.resolve(root);
  const output = [];
  await walk(absolute, absolute, output);
  return output;
}

export async function directoryDigest(root) {
  return sha256(canonicalJson(await directoryManifest(root)));
}

export async function fileDigest(file) {
  return sha256(await fsp.readFile(file));
}
