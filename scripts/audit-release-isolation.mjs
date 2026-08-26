#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { auditHiddenMaterialIsolation } from '../src/dataset/hidden-release.mjs';
import { runProcess } from '../src/lib/process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenPath = /(^|\/)(?:private-oracles|hidden-oracles)(?:\/|$)|\.moss-eval\/private-oracles/i;
const highConfidenceSecret = /\bsk-(?:proj-)?[A-Za-z0-9_]{20,}\b/g;

const git = await runProcess({ command: 'git', args: ['ls-files', '-z'], cwd: root, timeoutMs: 30000 });
if (git.exitCode !== 0) throw new Error('Unable to enumerate tracked files for release isolation audit');
const tracked = git.stdout.split('\0').filter(Boolean).map((item) => item.replaceAll('\\', '/'));

const npmCli = process.env.npm_execpath;
const packed = npmCli
  ? await runProcess({ command: process.execPath, args: [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], cwd: root, timeoutMs: 60000 })
  : await runProcess({ command: 'npm', args: ['pack', '--dry-run', '--json', '--ignore-scripts'], cwd: root, timeoutMs: 60000 });
if (packed.exitCode !== 0) throw new Error('Unable to enumerate packaged files for release isolation audit');
const packageReport = JSON.parse(packed.stdout);
const packaged = (packageReport[0]?.files || []).map((item) => String(item.path).replaceAll('\\', '/'));

const findings = [];
for (const item of tracked) {
  if (forbiddenPath.test(item)) findings.push({ surface: 'git-tracked', path: item, reason: 'private-path-is-tracked' });
  const file = path.join(root, ...item.split('/'));
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const content = await fsp.readFile(file, 'utf8').catch(() => '');
  const matches = content.match(highConfidenceSecret) || [];
  if (matches.length) findings.push({ surface: 'git-tracked', path: item, reason: 'high-confidence-secret-pattern', count: matches.length });
}
for (const item of packaged) {
  if (forbiddenPath.test(item)) findings.push({ surface: 'npm-package', path: item, reason: 'private-path-is-packaged' });
}

let identityAudit = null;
const privateBundleRoot = process.env.MOSS_EVAL_PRIVATE_ORACLE_BUNDLE;
if (privateBundleRoot) {
  const publicRoots = [root];
  if (process.env.MOSS_EVAL_RELEASE_RUN_ROOT) publicRoots.push(path.resolve(process.env.MOSS_EVAL_RELEASE_RUN_ROOT));
  identityAudit = await auditHiddenMaterialIsolation({
    publicRoots,
    privateBundleRoot: path.resolve(privateBundleRoot),
    forbiddenValues: [process.env.MOSS_EVAL_HIDDEN_SALT].filter(Boolean),
  });
  findings.push(...identityAudit.findings.map((item) => ({ surface: 'content-identity', ...item })));
}

const report = {
  schema_version: '1.0',
  pass: findings.length === 0,
  tracked_file_count: tracked.length,
  packaged_file_count: packaged.length,
  private_identity_audit: identityAudit,
  findings,
  limitation: privateBundleRoot ? null : 'No private bundle supplied; exact hidden-content identity scan was not executed.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.pass) process.exitCode = 1;
