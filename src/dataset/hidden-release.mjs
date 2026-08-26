import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { directoryManifest, fileDigest, safeDatasetPath } from './canonical.mjs';
import { buildHiddenBundleManifest, digestArtifact } from './governance.mjs';
import { runProcess } from '../lib/process.mjs';

const TASK_ID = /^real-[a-z0-9][a-z0-9-]*$/;
const SECRET_NAME = /(api.?key|token|secret|password|authorization|cookie|credential)/i;

function cleanOracleEnvironment() {
  const allowed = new Set([
    'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC',
    'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
  ]);
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([name]) => allowed.has(name) && !SECRET_NAME.test(name))
      .concat([['MOSS_EVAL_ORACLE_MODE', 'hidden-release']]),
  );
}

function parseDecision(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return null;
  try {
    const value = JSON.parse(line);
    if (!value || !['pass', 'fail'].includes(value.decision) || !Array.isArray(value.reasons)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function loadPrivateOracleBundle(bundleRoot, expectedTaskIds = []) {
  const root = path.resolve(bundleRoot);
  const descriptorFile = path.join(root, 'bundle.json');
  const descriptor = JSON.parse(await fsp.readFile(descriptorFile, 'utf8'));
  const errors = [];
  if (descriptor.schema_version !== '1.0') errors.push('bundle.json schema_version must be 1.0');
  if (!Array.isArray(descriptor.cases) || descriptor.cases.length === 0) errors.push('bundle.json cases must be non-empty');
  const cases = new Map();
  for (const [index, item] of (descriptor.cases || []).entries()) {
    if (!TASK_ID.test(item?.task_id || '')) errors.push(`cases.${index}.task_id is invalid`);
    if (cases.has(item?.task_id)) errors.push(`duplicate hidden Oracle task ${item.task_id}`);
    let oracle;
    try {
      oracle = safeDatasetPath(root, item?.oracle || '', `cases.${index}.oracle`);
      if ((await fsp.stat(oracle)).isFile() !== true) errors.push(`cases.${index}.oracle is not a file`);
    } catch (error) {
      errors.push(`cases.${index}.oracle is unavailable: ${error.message}`);
    }
    if (item?.task_id) cases.set(item.task_id, { task_id: item.task_id, oracle });
  }
  const expected = [...new Set(expectedTaskIds)].sort();
  const actual = [...cases.keys()].sort();
  const missing = expected.filter((id) => !cases.has(id));
  const unexpected = expected.length ? actual.filter((id) => !expected.includes(id)) : [];
  if (missing.length) errors.push(`hidden Oracle tasks missing: ${missing.join(', ')}`);
  if (unexpected.length) errors.push(`unexpected hidden Oracle tasks: ${unexpected.join(', ')}`);
  if (errors.length) throw Object.assign(new Error(`Invalid private Oracle bundle:\n- ${errors.join('\n- ')}`), { code: 'HIDDEN_BUNDLE_INVALID', errors });
  return { root, descriptor, cases };
}

export async function runHiddenOracleBundle({
  bundleRoot,
  salt,
  expectedBundleDigest = null,
  trials,
  timeoutMs = 15000,
  output = null,
}) {
  if (!Array.isArray(trials) || trials.length === 0) throw new Error('Hidden release trials are required');
  const taskIds = trials.map((trial) => trial.task_id);
  if (new Set(taskIds).size !== taskIds.length) throw new Error('Hidden release trials must contain unique task IDs');
  const bundle = await loadPrivateOracleBundle(bundleRoot, taskIds);
  const manifest = await buildHiddenBundleManifest(bundle.root, { salt });
  if (expectedBundleDigest && manifest.bundle_digest !== expectedBundleDigest) {
    throw Object.assign(new Error('Private Oracle bundle digest does not match the frozen release manifest'), { code: 'HIDDEN_BUNDLE_DIGEST_MISMATCH' });
  }

  const results = [];
  for (const trial of trials) {
    const sourceWorkspace = path.resolve(trial.workspace);
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-hidden-oracle-'));
    try {
      const workspace = path.join(temp, 'workspace');
      await fsp.cp(sourceWorkspace, workspace, { recursive: true, force: false, errorOnExist: true });
      const oracle = bundle.cases.get(trial.task_id).oracle;
      const execution = await runProcess({
        command: process.execPath,
        args: [oracle, workspace, trial.task_id, '--json'],
        cwd: workspace,
        env: cleanOracleEnvironment(),
        timeoutMs,
        outputLimit: 1024 * 1024,
      });
      const decision = parseDecision(execution.stdout);
      const executionValid = !execution.startError && !execution.timedOut && !execution.outputTruncated && [0, 1].includes(execution.exitCode) && decision !== null;
      results.push({
        task_id: trial.task_id,
        passed: executionValid && decision.decision === 'pass' && execution.exitCode === 0,
        execution_valid: executionValid,
        reason_codes: decision?.reasons || ['hidden-oracle-execution-invalid'],
        duration_ms: execution.durationMs,
        workspace_digest: digestArtifact(await directoryManifest(sourceWorkspace)),
      });
    } finally {
      await fsp.rm(temp, { recursive: true, force: true });
    }
  }

  const body = {
    schema_version: '1.0',
    bundle_digest: manifest.bundle_digest,
    task_count: results.length,
    run_passed: results.every((item) => item.passed),
    execution_valid: results.every((item) => item.execution_valid),
    results,
  };
  const receipt = { ...body, receipt_digest: digestArtifact(body) };
  if (output) {
    const target = path.resolve(output);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }
  return receipt;
}

export async function auditHiddenMaterialIsolation({ publicRoots, privateBundleRoot = null, forbiddenValues = [] }) {
  const hiddenDigests = new Set();
  if (privateBundleRoot) {
    for (const item of await directoryManifest(privateBundleRoot)) {
      hiddenDigests.add(await fileDigest(path.join(path.resolve(privateBundleRoot), ...item.path.split('/'))));
    }
  }
  const findings = [];
  for (const rootValue of publicRoots) {
    const root = path.resolve(rootValue);
    for (const item of await directoryManifest(root)) {
      const file = path.join(root, ...item.path.split('/'));
      if (hiddenDigests.has(item.sha256)) findings.push({ root, path: item.path, reason: 'exact-hidden-content-match' });
      if (item.size > 2 * 1024 * 1024) continue;
      const text = await fsp.readFile(file, 'utf8').catch(() => '');
      for (const value of forbiddenValues.filter((entry) => typeof entry === 'string' && entry.length >= 8)) {
        if (text.includes(value)) findings.push({ root, path: item.path, reason: 'forbidden-value-match' });
      }
    }
  }
  return { pass: findings.length === 0, roots_checked: publicRoots.length, hidden_content_identities: hiddenDigests.size, findings };
}
