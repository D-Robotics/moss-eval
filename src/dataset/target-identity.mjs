import fsp from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../lib/process.mjs';

export const OFFICIAL_MOSS_REMOTE = 'github.com/D-Robotics/moss.git';

export function normalizeGitRemote(value) {
  return String(value || '')
    .trim()
    .replace(/^git@/, '')
    .replace(/^ssh:\/\/git@/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(':', '/')
    .replace(/\/$/, '');
}

async function checked(processRunner, specification, label) {
  const result = await processRunner(specification);
  if (result.startError || result.timedOut || result.exitCode !== 0) {
    throw new Error(label + ' failed' + (result.stderr ? ': ' + result.stderr.trim() : ''));
  }
  return result.stdout.trim();
}

export async function resolveOfficialTarget(options = {}) {
  const processRunner = options.processRunner || runProcess;
  const repository = options.repository || 'git@github.com:D-Robotics/moss.git';
  const authoritative = normalizeGitRemote(options.authoritativeRemote || OFFICIAL_MOSS_REMOTE);
  const normalized = normalizeGitRemote(repository);
  if (normalized !== authoritative) throw new Error('Repository is not the approved official MOSS remote');
  const ref = options.ref || 'refs/heads/main';
  const output = await checked(processRunner, {
    command: 'git',
    args: ['ls-remote', repository, ref],
    cwd: options.cwd || process.cwd(),
    timeoutMs: options.timeoutMs || 30000,
  }, 'git ls-remote');
  const commit = output.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Official MOSS ref did not resolve to a commit');
  return { repository, normalized_repository: normalized, authoritative_remote: authoritative, ref, commit };
}

export async function inspectLocalTarget(directory, options = {}) {
  const processRunner = options.processRunner || runProcess;
  const run = (args, label) => checked(processRunner, { command: 'git', args: ['-C', directory, ...args], cwd: directory, timeoutMs: 30000 }, label);
  const [commit, branch, remote, dirty] = await Promise.all([
    run(['rev-parse', 'HEAD'], 'local commit'),
    run(['rev-parse', '--abbrev-ref', 'HEAD'], 'local branch'),
    run(['remote', 'get-url', 'origin'], 'local remote'),
    run(['status', '--porcelain'], 'local status'),
  ]);
  return {
    directory: path.resolve(directory),
    commit,
    branch,
    remote,
    normalized_remote: normalizeGitRemote(remote),
    dirty: Boolean(dirty),
  };
}

export async function prepareCleanTargetSnapshot(identity, destination, options = {}) {
  const processRunner = options.processRunner || runProcess;
  const target = path.resolve(destination);
  try {
    const entries = await fsp.readdir(target);
    if (entries.length) throw new Error('Snapshot destination must be absent or empty');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const gitVersion = await checked(processRunner, {
    command: 'git', args: ['--version'], cwd: path.dirname(target), timeoutMs: 30000,
  }, 'git version');
  const match = gitVersion.match(/(\d+)\.(\d+)/);
  const supportsPartialClone = match && (Number(match[1]) > 2 || (Number(match[1]) === 2 && Number(match[2]) >= 19));
  const branch = identity.ref.startsWith('refs/heads/') ? identity.ref.slice('refs/heads/'.length) : null;
  const cloneArgs = ['clone'];
  if (supportsPartialClone) cloneArgs.push('--filter=blob:none');
  cloneArgs.push('--no-checkout');
  if (branch) cloneArgs.push('--depth', '1', '--single-branch', '--branch', branch);
  cloneArgs.push(identity.repository, target);
  await checked(processRunner, {
    command: 'git',
    args: cloneArgs,
    cwd: path.dirname(target),
    timeoutMs: options.timeoutMs || 300000,
  }, 'clean snapshot clone');
  await checked(processRunner, {
    command: 'git',
    args: ['-C', target, 'checkout', '--detach', identity.commit],
    cwd: target,
    timeoutMs: options.timeoutMs || 300000,
  }, 'clean snapshot checkout');
  const inspected = await inspectLocalTarget(target, { processRunner });
  const blockers = [];
  if (inspected.commit !== identity.commit) blockers.push('snapshot-commit-mismatch');
  if (inspected.dirty) blockers.push('snapshot-is-dirty');
  if (inspected.normalized_remote !== identity.authoritative_remote) blockers.push('snapshot-remote-mismatch');
  return { ...inspected, official: blockers.length === 0, blockers, identity };
}
