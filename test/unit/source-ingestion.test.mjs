import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProcess } from '../../src/lib/process.mjs';
import {
  SourceIngestionError,
  ingestGitHubSource,
  ingestLocalSource,
  inspectLocalGit,
  normalizeGitHubUrl,
  planSourceRetention,
  resolveGitHubCommit,
} from '../../src/core/source-ingestion.mjs';

async function temporaryRoots(t, name) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const storage = path.join(root, 'storage');
  await fsp.mkdir(source, { recursive: true });
  return { root, source, storage };
}

test('local source ingestion creates immutable deduplicated snapshots and leaves originals untouched', async (t) => {
  const { source, storage } = await temporaryRoots(t, 'moss-eval-source');
  await fsp.mkdir(path.join(source, 'src'), { recursive: true });
  await fsp.mkdir(path.join(source, 'node_modules/pkg'), { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(source, 'src/index.js'), 'export const value = 1;\n'),
    fsp.writeFile(path.join(source, 'package.json'), '{"name":"fixture"}\n'),
    fsp.writeFile(path.join(source, '.env'), 'SECRET=do-not-copy\n'),
    fsp.writeFile(path.join(source, 'node_modules/pkg/index.js'), 'dependency\n'),
  ]);

  const first = await ingestLocalSource(source, { sourcesRoot: storage, git: null });
  assert.equal(first.type, 'local');
  assert.equal(first.snapshot.file_count, 2);
  assert.equal(first.snapshot.immutable, true);
  assert.match(first.snapshot_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(await fsp.readFile(path.join(first.snapshot_path, 'src/index.js'), 'utf8'), 'export const value = 1;\n');
  await assert.rejects(fsp.access(path.join(first.snapshot_path, '.env')));
  await assert.rejects(fsp.access(path.join(first.snapshot_path, 'node_modules/pkg/index.js')));
  assert.equal(await fsp.readFile(path.join(source, '.env'), 'utf8'), 'SECRET=do-not-copy\n');

  const duplicate = await ingestLocalSource(source, { sourcesRoot: storage, git: null });
  assert.equal(duplicate.snapshot_fingerprint, first.snapshot_fingerprint);
  assert.equal(duplicate.reused_snapshot, true);

  await fsp.writeFile(path.join(source, 'src/index.js'), 'export const value = 2;\n');
  const refreshed = await ingestLocalSource(source, { sourcesRoot: storage, git: null });
  assert.notEqual(refreshed.snapshot_fingerprint, first.snapshot_fingerprint);
  assert.equal(await fsp.readFile(path.join(first.snapshot_path, 'src/index.js'), 'utf8'), 'export const value = 1;\n');
  assert.equal(await fsp.readFile(path.join(refreshed.snapshot_path, 'src/index.js'), 'utf8'), 'export const value = 2;\n');

  const retention = await planSourceRetention(storage, { keep: 1 });
  assert.equal(retention.keep.length, 1);
  assert.equal(retention.candidates.length, 1);
});

test('source ingestion enforces limits before accepting a snapshot', async (t) => {
  const { source, storage } = await temporaryRoots(t, 'moss-eval-limits');
  await Promise.all([
    fsp.writeFile(path.join(source, 'a.txt'), 'a'),
    fsp.writeFile(path.join(source, 'b.txt'), 'b'),
  ]);
  await assert.rejects(
    ingestLocalSource(source, { sourcesRoot: storage, git: null, limits: { maxFiles: 1 } }),
    (error) => error instanceof SourceIngestionError && error.code === 'SOURCE_FILE_COUNT_EXCEEDED',
  );
  const snapshots = await fsp.readdir(path.join(storage, 'snapshots'));
  assert.deepEqual(snapshots, []);
});

test('source ingestion excludes junctions that could escape the selected root', async (t) => {
  const { root, source, storage } = await temporaryRoots(t, 'moss-eval-junction');
  const external = path.join(root, 'external');
  await fsp.mkdir(external);
  await fsp.writeFile(path.join(external, 'outside.txt'), 'outside');
  try {
    await fsp.symlink(external, path.join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Creating links is not permitted on this host');
    throw error;
  }
  const record = await ingestLocalSource(source, { sourcesRoot: storage, git: null });
  assert.equal(record.snapshot.file_count, 0);
  assert.ok(record.warnings.some((warning) => warning.reason === 'symbolic-link-or-junction'));
  await assert.rejects(fsp.access(path.join(record.snapshot_path, 'escape/outside.txt')));
});

test('local Git provenance records revision and dirty state without mutating the worktree', async (t) => {
  const { source } = await temporaryRoots(t, 'moss-eval-git');
  const checked = async (args) => {
    const result = await runProcess({ command: 'git', args, timeoutMs: 10_000 });
    assert.equal(result.exitCode, 0, result.stderr);
  };
  await checked(['init', source]);
  await checked(['-C', source, 'config', 'user.email', 'fixture@example.com']);
  await checked(['-C', source, 'config', 'user.name', 'Fixture']);
  await fsp.writeFile(path.join(source, 'tracked.txt'), 'one\n');
  await checked(['-C', source, 'add', 'tracked.txt']);
  await checked(['-C', source, 'commit', '-m', 'fixture']);
  const before = await runProcess({ command: 'git', args: ['-C', source, 'rev-parse', 'HEAD'] });
  await fsp.writeFile(path.join(source, 'tracked.txt'), 'two\n');
  await fsp.writeFile(path.join(source, 'untracked.txt'), 'new\n');

  const provenance = await inspectLocalGit(source);
  const after = await runProcess({ command: 'git', args: ['-C', source, 'rev-parse', 'HEAD'] });
  assert.equal(provenance.commit, before.stdout.trim());
  assert.equal(after.stdout.trim(), before.stdout.trim());
  assert.equal(provenance.dirty, true);
  assert.equal(provenance.changed_entry_count, 2);
});

test('GitHub URLs and refs normalize to canonical immutable commits', async () => {
  assert.deepEqual(normalizeGitHubUrl('https://github.com/D-Robotics/moss'), {
    owner: 'D-Robotics', repository: 'moss', canonicalUrl: 'https://github.com/D-Robotics/moss.git',
  });
  assert.throws(() => normalizeGitHubUrl('https://example.com/repo'), /Only credential-free/);
  assert.throws(() => normalizeGitHubUrl('https://github.com/D-Robotics/moss/tree/main'), /repository root/);
  const commit = 'a'.repeat(40);
  const resolved = await resolveGitHubCommit('https://github.com/D-Robotics/moss.git', null, {
    processRunner: async () => ({
      exitCode: 0, timedOut: false, startError: null,
      stdout: `ref: refs/heads/main\tHEAD\n${commit}\tHEAD\n`, stderr: '',
    }),
  });
  assert.equal(resolved, commit);
});

test('GitHub ingestion snapshots the verified checkout and records clone bounds', async (t) => {
  const { storage } = await temporaryRoots(t, 'moss-eval-github');
  const commit = 'b'.repeat(40);
  const calls = [];
  const processRunner = async (spec) => {
    calls.push(spec);
    if (spec.args[0] === 'ls-remote') {
      return { exitCode: 0, timedOut: false, startError: null, stdout: `${commit}\tHEAD\n`, stderr: '' };
    }
    if (spec.args[0] === 'init') await fsp.mkdir(spec.args[1], { recursive: true });
    const checkoutIndex = spec.args.indexOf('-C');
    const checkout = checkoutIndex >= 0 ? spec.args[checkoutIndex + 1] : null;
    if (spec.args.includes('checkout')) await fsp.writeFile(path.join(checkout, 'package.json'), '{"name":"remote"}\n');
    const stdout = spec.args.includes('rev-parse') ? `${commit}\n` : '';
    return { exitCode: 0, timedOut: false, startError: null, stdout, stderr: '' };
  };
  const record = await ingestGitHubSource('https://github.com/acme/agent', {
    sourcesRoot: storage,
    processRunner,
    limits: { cloneTimeoutMs: 1234, cloneOutputLimit: 4321 },
  });
  assert.equal(record.type, 'github');
  assert.equal(record.revision, commit);
  assert.equal(record.canonical_location, 'https://github.com/acme/agent.git');
  assert.equal(await fsp.readFile(path.join(record.snapshot_path, 'package.json'), 'utf8'), '{"name":"remote"}\n');
  assert.ok(calls.filter((call) => call.args[0] !== 'ls-remote').every((call) => call.timeoutMs === 1234));
  assert.ok(calls.some((call) => call.args.includes('--depth')));
});
