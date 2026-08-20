import fsp from 'node:fs/promises';
import path from 'node:path';

export const STORAGE_SCHEMA_VERSION = '1.0';

export function resolveStoragePaths(options = {}) {
  if (!options.userDataRoot) throw new Error('userDataRoot is required');
  const userDataRoot = path.resolve(options.userDataRoot);
  const packaged = Boolean(options.packaged);
  const projectRoot = packaged
    ? path.resolve(options.resourcesPath || '', options.resourceDirectory || 'project')
    : path.resolve(options.projectRoot || process.cwd());
  return Object.freeze({
    schemaVersion: STORAGE_SCHEMA_VERSION,
    packaged,
    projectRoot,
    root: userDataRoot,
    config: path.join(userDataRoot, 'config'),
    sources: path.join(userDataRoot, 'sources'),
    targets: path.join(userDataRoot, 'targets'),
    runs: path.join(userDataRoot, 'runs'),
    cache: path.join(userDataRoot, 'cache'),
    logs: path.join(userDataRoot, 'logs'),
  });
}

export async function ensureStoragePaths(paths) {
  for (const key of ['root', 'config', 'sources', 'targets', 'runs', 'cache', 'logs']) {
    await fsp.mkdir(paths[key], { recursive: true });
  }
  return paths;
}
