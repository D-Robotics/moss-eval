import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import {
  inspectLocalTarget,
  normalizeGitRemote,
  prepareCleanTargetSnapshot,
  resolveOfficialTarget,
} from '../../src/dataset/target-identity.mjs';

const exec = promisify(execFile);

test('normalizes official SSH and HTTPS remotes consistently', () => {
  assert.equal(normalizeGitRemote('git@github.com:D-Robotics/moss.git'), 'github.com/D-Robotics/moss.git');
  assert.equal(normalizeGitRemote('https://github.com/D-Robotics/moss.git'), 'github.com/D-Robotics/moss.git');
});

test('rejects a non-authoritative target remote before network access', async () => {
  await assert.rejects(() => resolveOfficialTarget({ repository: 'https://example.invalid/moss.git' }), /not the approved/);
});

test('prepares a clean pinned snapshot without modifying a dirty source checkout', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-target-identity-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const snapshot = path.join(root, 'snapshot');
  await fsp.mkdir(source);
  await exec('git', ['init'], { cwd: source });
  await exec('git', ['config', 'user.email', 'test@example.invalid'], { cwd: source });
  await exec('git', ['config', 'user.name', 'Dataset Test'], { cwd: source });
  await fsp.writeFile(path.join(source, 'README.md'), 'pinned\n');
  await exec('git', ['add', 'README.md'], { cwd: source });
  await exec('git', ['commit', '-m', 'initial'], { cwd: source });
  await exec('git', ['branch', '-M', 'main'], { cwd: source });
  await exec('git', ['remote', 'add', 'origin', source], { cwd: source });
  const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  await fsp.writeFile(path.join(source, 'local-only.txt'), 'dirty\n');
  const dirtyBefore = await inspectLocalTarget(source);
  assert.equal(dirtyBefore.dirty, true);
  const identity = { repository: source, normalized_repository: normalizeGitRemote(source), authoritative_remote: normalizeGitRemote(source), ref: 'refs/heads/main', commit };
  const prepared = await prepareCleanTargetSnapshot(identity, snapshot);
  assert.equal(prepared.official, true);
  assert.equal(prepared.commit, commit);
  assert.equal((await inspectLocalTarget(source)).dirty, true);
});
