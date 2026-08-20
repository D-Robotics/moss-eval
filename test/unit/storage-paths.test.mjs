import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureStoragePaths, resolveStoragePaths } from '../../src/core/storage-paths.mjs';

test('storage paths separate packaged resources from mutable user data', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-paths-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const userDataRoot = path.join(directory, 'user-data');
  const resourcesPath = path.join(directory, 'read-only-resources');
  const paths = resolveStoragePaths({ userDataRoot, packaged: true, resourcesPath });
  assert.equal(paths.projectRoot, path.join(resourcesPath, 'project'));
  assert.equal(paths.runs, path.join(userDataRoot, 'runs'));
  assert.equal(paths.sources, path.join(userDataRoot, 'sources'));
  await ensureStoragePaths(paths);
  for (const key of ['config', 'sources', 'targets', 'runs', 'cache', 'logs']) {
    assert.equal((await fsp.stat(paths[key])).isDirectory(), true);
  }
});

test('development storage resolves project resources from the checkout', () => {
  const paths = resolveStoragePaths({
    userDataRoot: 'D:/user-data',
    packaged: false,
    projectRoot: 'D:/moss-eval',
  });
  assert.equal(paths.projectRoot, path.resolve('D:/moss-eval'));
});
