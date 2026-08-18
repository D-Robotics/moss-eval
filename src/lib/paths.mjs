import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function sanitizeId(value) {
  const result = String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!result) throw new Error('Identifier cannot be empty');
  return result.slice(0, 120);
}

export function assertWithin(parentPath, targetPath, label = 'path') {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(parent, target);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    return target;
  }
  throw new Error(label + ' escapes allowed root: ' + target);
}

export function resolveRelative(baseDirectory, candidate) {
  if (!candidate) return null;
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(baseDirectory, candidate);
}

export async function copyFixture(source, destination) {
  if (!source) {
    await fsp.mkdir(destination, { recursive: true });
    return;
  }
  const stat = await fsp.stat(source);
  if (!stat.isDirectory()) throw new Error('Fixture must be a directory: ' + source);
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (item) => {
      const name = path.basename(item);
      return name !== '.git' && name !== 'node_modules';
    },
  });
}

async function walk(root, current, output, ignored) {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      await walk(root, absolute, output, ignored);
    } else if (entry.isFile()) {
      const content = await fsp.readFile(absolute);
      output.push({
        path: relative,
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  }
}

export async function createManifest(root, options = {}) {
  const output = [];
  const ignored = new Set(options.ignored || ['.git', 'node_modules', '.moss-eval']);
  try {
    await walk(path.resolve(root), path.resolve(root), output, ignored);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return output;
}

export function diffManifests(before, after) {
  const left = new Map(before.map((item) => [item.path, item]));
  const right = new Map(after.map((item) => [item.path, item]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [file, item] of right) {
    if (!left.has(file)) added.push(file);
    else if (left.get(file).sha256 !== item.sha256) changed.push(file);
  }
  for (const file of left.keys()) if (!right.has(file)) removed.push(file);
  return { added, removed, changed };
}
