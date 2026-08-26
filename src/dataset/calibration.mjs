import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../lib/process.mjs';
import { copyFixture } from '../lib/paths.mjs';
import { auditProfessionalDataset } from './audit.mjs';
import { canonicalJson, directoryManifest, sha256 } from './canonical.mjs';

async function applyOverlay(source, workspace) {
  await fsp.cp(source, workspace, {
    recursive: true,
    force: true,
    filter: (item) => !['.git', 'node_modules'].includes(path.basename(item)),
  });
}

function oracleDecision(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('Oracle produced no structured decision');
  const value = JSON.parse(lines.at(-1));
  if (!value || !['pass', 'fail'].includes(value.decision) || !Array.isArray(value.reasons)) {
    throw new Error('Oracle decision must contain decision=pass|fail and reasons[]');
  }
  return value;
}

export async function executeDatasetOracle(card, workspace, options = {}) {
  const processRunner = options.processRunner || runProcess;
  const result = await processRunner({
    command: process.execPath,
    args: [card._meta.oracle, workspace, card.id, '--json'],
    cwd: card._meta.directory,
    env: { ...process.env, MOSS_EVAL_ORACLE_MODE: 'calibration' },
    timeoutMs: card.oracle.timeout_seconds * 1000,
    outputLimit: 1024 * 1024,
  });
  if (result.startError) throw new Error('Oracle could not start: ' + result.startError.code);
  if (result.timedOut) throw new Error('Oracle timed out');
  if (result.outputTruncated) throw new Error('Oracle output exceeded limit');
  if (result.exitCode !== 0) throw new Error('Oracle execution failed with exit code ' + result.exitCode);
  return oracleDecision(result.stdout);
}

async function runControl(card, control, options) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-prof-control-'));
  const workspace = path.join(root, 'workspace');
  try {
    await copyFixture(card._meta.fixture, workspace);
    await applyOverlay(card._meta.controls[control.id], workspace);
    const beforeOracle = await directoryManifest(workspace);
    const decision = await executeDatasetOracle(card, workspace, options);
    const afterOracle = await directoryManifest(workspace);
    const oracleMutatedWorkspace = canonicalJson(beforeOracle) !== canonicalJson(afterOracle);
    const actualPass = decision.decision === 'pass';
    return {
      control_id: control.id,
      kind: control.kind,
      expected_pass: control.expected_pass,
      actual_pass: actualPass,
      correct: actualPass === control.expected_pass && !oracleMutatedWorkspace,
      execution_status: 'completed',
      oracle_mutated_workspace: oracleMutatedWorkspace,
      reason_codes: decision.reasons.map((reason) => String(reason)).sort(),
      workspace_instance: sha256(root).slice(0, 16),
    };
  } catch (error) {
    return {
      control_id: control.id,
      kind: control.kind,
      expected_pass: control.expected_pass,
      actual_pass: null,
      correct: false,
      execution_status: 'error',
      error: error.message,
      workspace_instance: sha256(root).slice(0, 16),
    };
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

export async function calibrateProfessionalDataset(datasetRoot, options = {}) {
  const audited = await auditProfessionalDataset(datasetRoot);
  if (audited.report.technical_gate !== 'pass') {
    return {
      report: {
        schema_version: '1.0',
        dataset: audited.report.dataset,
        dataset_digest: audited.report.content_digest,
        gate: 'fail',
        task_count: audited.dataset.cards.length,
        control_count: 0,
        positive_false_negative_rate: null,
        negative_false_positive_rate: null,
        execution_error_rate: null,
        blockers: ['technical-dataset-gate-failed'],
        tasks: [],
      },
      dataset: audited.dataset,
    };
  }
  const tasks = [];
  for (const card of audited.dataset.cards) {
    const controls = [];
    for (const control of card.controls) controls.push(await runControl(card, control, options));
    const errors = controls.filter((item) => item.execution_status === 'error');
    const falseNegatives = controls.filter((item) => item.kind === 'positive' && item.actual_pass === false);
    const falsePositives = controls.filter((item) => item.kind === 'negative' && item.actual_pass === true);
    const workspaceReuse = new Set(controls.map((item) => item.workspace_instance)).size !== controls.length;
    tasks.push({
      task_id: card.id,
      gate: errors.length === 0 && falseNegatives.length === 0 && falsePositives.length === 0 && !workspaceReuse && controls.every((item) => item.correct) ? 'pass' : 'fail',
      controls,
      positive_false_negatives: falseNegatives.length,
      negative_false_positives: falsePositives.length,
      execution_errors: errors.length,
      isolated_workspaces: !workspaceReuse,
    });
  }
  const controls = tasks.flatMap((task) => task.controls);
  const positives = controls.filter((item) => item.kind === 'positive');
  const negatives = controls.filter((item) => item.kind === 'negative');
  const errors = controls.filter((item) => item.execution_status === 'error');
  const report = {
    schema_version: '1.0',
    dataset: audited.report.dataset,
    dataset_digest: audited.report.content_digest,
    gate: tasks.every((task) => task.gate === 'pass') ? 'pass' : 'fail',
    task_count: tasks.length,
    control_count: controls.length,
    positive_false_negative_rate: positives.length ? positives.filter((item) => item.actual_pass === false).length / positives.length : null,
    negative_false_positive_rate: negatives.length ? negatives.filter((item) => item.actual_pass === true).length / negatives.length : null,
    execution_error_rate: controls.length ? errors.length / controls.length : null,
    blockers: tasks.filter((task) => task.gate !== 'pass').map((task) => task.task_id + ':calibration-failed'),
    tasks,
  };
  return { report, dataset: audited.dataset };
}

function calibrationMarkdown(report) {
  return [
    '# Professional task-specific calibration',
    '',
    `- Dataset: ${report.dataset.id}@${report.dataset.version}`,
    `- Dataset digest: ${report.dataset_digest}`,
    `- Controls executed: ${report.control_count}`,
    `- Positive false-negative rate: ${report.positive_false_negative_rate}`,
    `- Negative false-positive rate: ${report.negative_false_positive_rate}`,
    `- Execution-error rate: ${report.execution_error_rate}`,
    `- Gate: **${report.gate.toUpperCase()}**`,
    '',
    ...report.tasks.map((task) => `- ${task.task_id}: ${task.gate} (${task.controls.length} isolated controls)`),
    '',
  ].join('\n');
}

export async function writeCalibrationReport(report, outputDirectory) {
  await fsp.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outputDirectory, 'calibration.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'),
    fsp.writeFile(path.join(outputDirectory, 'calibration.md'), calibrationMarkdown(report), 'utf8'),
  ]);
  return outputDirectory;
}
