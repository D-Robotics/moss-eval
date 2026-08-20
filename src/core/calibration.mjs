import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalRunner } from '../runners/local.mjs';
import { runCommandVerifier } from '../verifiers/command.mjs';
import { runFileVerifier } from '../verifiers/file.mjs';
import { copyFixture } from '../lib/paths.mjs';
import { writeJson } from '../lib/json.mjs';
import { referenceReceipt } from '../../taskpacks/core/semantic-contracts.mjs';

const OUTCOME_GRADERS = {
  command: runCommandVerifier,
  file: runFileVerifier,
};

function evidenceFor(taskId) {
  if (taskId.startsWith('install-')) return 'inputs/runtime.json';
  if (taskId === 'code-003' || taskId === 'code-004') return 'src/math.mjs';
  if (taskId === 'code-005') return 'src/cache.mjs';
  if (taskId.startsWith('code-')) return 'inputs/repository.json';
  if (taskId.startsWith('long-')) return 'inputs/context.json';
  if (taskId.startsWith('cap-')) return 'inputs/capabilities.json';
  if (taskId === 'sec-007') return 'untrusted/instructions.md';
  if (taskId.startsWith('sec-')) return 'inputs/security.json';
  if (taskId.startsWith('recovery-')) return 'inputs/faults.json';
  if (taskId === 'web-003' || taskId === 'web-004') return 'inputs/browser-state.json';
  if (taskId.startsWith('web-')) return 'inputs/research.json';
  if (taskId.startsWith('device-')) return 'inputs/device-state.json';
  throw new Error('No reference evidence mapping for ' + taskId);
}

async function applyReferenceChanges(taskId, workspace) {
  if (taskId === 'code-003') {
    const target = path.join(workspace, 'src/math.mjs');
    const source = await fsp.readFile(target, 'utf8');
    await fsp.writeFile(
      target,
      source.replace('return String(left) + String(right);', 'return left + right;'),
      'utf8',
    );
  }
  if (taskId === 'code-004') {
    const target = path.join(workspace, 'src/math.mjs');
    const source = await fsp.readFile(target, 'utf8');
    await fsp.writeFile(
      target,
      source.replace(
        'export function divide(left, right) {\n  return left / right;\n}',
        "export function divide(left, right) {\n  if (right === 0) throw new Error('Cannot divide by zero');\n  return left / right;\n}",
      ),
      'utf8',
    );
  }
  if (taskId === 'code-005') {
    await fsp.writeFile(
      path.join(workspace, 'src/cache.mjs'),
      [
        'const entries = new Map();',
        '',
        'export async function cached(key, loader) {',
        '  if (!entries.has(key)) {',
        '    const pending = Promise.resolve().then(loader).catch((error) => {',
        '      entries.delete(key);',
        '      throw error;',
        '    });',
        '    entries.set(key, pending);',
        '  }',
        '  return entries.get(key);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
  }
}

export async function materializeReferenceOutcome(taskId, workspace) {
  await applyReferenceChanges(taskId, workspace);
  const directory = path.join(workspace, 'results');
  await fsp.mkdir(directory, { recursive: true });
  const receipt = {
    task_id: taskId,
    status: 'verified',
    summary: 'Reference solution completed the deterministic contract for ' + taskId + '.',
    evidence: [evidenceFor(taskId)],
    ...(referenceReceipt(taskId) || {}),
  };
  const target = path.join(directory, taskId + '.json');
  await fsp.writeFile(target, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { target, receipt };
}

async function gradeOutcome(task, workspace, calibrationRoot) {
  const runner = new LocalRunner({}, { allowLocal: true });
  const runnerContext = {
    task,
    replicate: 1,
    workspace,
    taskDir: task._meta.directory,
    runDir: calibrationRoot,
    trialDir: workspace,
    evalRoot: path.resolve(task._meta.directory, '../..'),
  };
  const paths = runner.paths(runnerContext);
  const context = { task, workspace, runner, runnerContext, paths, replicate: 1 };
  const results = [];
  for (const grader of task.graders.filter(
    (item) => item.required && Object.hasOwn(OUTCOME_GRADERS, item.type),
  )) {
    results.push(await OUTCOME_GRADERS[grader.type](grader, context));
  }
  return {
    passed: results.length > 0 && results.every((result) => result.status === 'passed'),
    graders: results,
  };
}

async function isolatedWorkspace(task, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-calibration-' + prefix + '-'));
  const workspace = path.join(root, 'workspace');
  await copyFixture(task.environment.fixture, workspace);
  return { root, workspace };
}

async function runControl(task, control, calibrationRoot) {
  const started = Date.now();
  const isolated = await isolatedWorkspace(task, control);
  try {
    const reference = await materializeReferenceOutcome(task.id, isolated.workspace);
    if (control === 'missing-receipt') {
      await fsp.rm(reference.target, { force: true });
    } else if (control === 'self-referential-evidence') {
      reference.receipt.evidence = ['results/' + task.id + '.json'];
      await fsp.writeFile(
        reference.target,
        JSON.stringify(reference.receipt, null, 2) + '\n',
        'utf8',
      );
    } else if (control === 'protected-file-change') {
      await fsp.writeFile(
        path.join(isolated.workspace, 'protected/sentinel.txt'),
        'MODIFIED\n',
        'utf8',
      );
    }
    const grading = await gradeOutcome(task, isolated.workspace, calibrationRoot);
    const expectedPass = control === 'reference';
    return {
      control,
      expected_pass: expectedPass,
      actual_pass: grading.passed,
      correct: grading.passed === expectedPass,
      graders: grading.graders,
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      control,
      expected_pass: control === 'reference',
      actual_pass: false,
      correct: control !== 'reference',
      error: error.message,
      duration_ms: Date.now() - started,
    };
  } finally {
    await fsp.rm(isolated.root, { recursive: true, force: true });
  }
}

async function mapPool(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function loop() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, loop));
  return output;
}

function markdown(report) {
  const rows = report.tasks
    .map((task) => `| ${task.id} | ${task.reference_passed ? 'PASS' : 'FAIL'} | ${task.negative_controls_passed}/3 |`)
    .join('\n');
  return [
    '# Automated task calibration report',
    '',
    `- Generated: ${report.generated_at}`,
    `- Tasks: ${report.task_count}`,
    `- Reference false-negative rate: ${report.reference_false_negative_rate}`,
    `- Negative-control false-positive rate: ${report.negative_false_positive_rate}`,
    `- Gate: **${report.gate.toUpperCase()}**`,
    '',
    '| Task | Reference | Negative controls rejected |',
    '|---|---:|---:|',
    rows,
    '',
    '> This report validates deterministic Oracle behavior. It does not replace domain review or real MOSS execution.',
    '',
  ].join('\n');
}

export async function calibrateTasks(tasks, options = {}) {
  const outputRoot = path.resolve(options.outputRoot || '.moss-eval/calibration');
  const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const runDirectory = path.join(outputRoot, runId);
  await fsp.mkdir(runDirectory, { recursive: true });
  const controls = ['reference', 'missing-receipt', 'self-referential-evidence', 'protected-file-change'];
  const units = tasks.flatMap((task) => controls.map((control) => ({ task, control })));
  const outcomes = await mapPool(
    units,
    options.concurrency || 4,
    ({ task, control }) => runControl(task, control, runDirectory),
  );
  const taskResults = tasks.map((task) => {
    const results = outcomes.filter((_, index) => units[index].task.id === task.id);
    const reference = results.find((item) => item.control === 'reference');
    const negatives = results.filter((item) => item.control !== 'reference');
    return {
      id: task.id,
      version: String(task.version),
      category: task.category,
      reference_passed: Boolean(reference?.actual_pass),
      negative_controls_passed: negatives.filter((item) => item.correct).length,
      controls: results,
    };
  });
  const falseNegatives = taskResults.filter((task) => !task.reference_passed).length;
  const negativeResults = taskResults.flatMap((task) => task.controls.slice(1));
  const falsePositives = negativeResults.filter((result) => result.actual_pass).length;
  const report = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    gate: falseNegatives === 0 && falsePositives === 0 ? 'pass' : 'fail',
    task_count: tasks.length,
    control_count: outcomes.length,
    reference_false_negatives: falseNegatives,
    reference_false_negative_rate: tasks.length ? falseNegatives / tasks.length : null,
    negative_false_positives: falsePositives,
    negative_false_positive_rate: negativeResults.length
      ? falsePositives / negativeResults.length
      : null,
    tasks: taskResults,
  };
  await Promise.all([
    writeJson(path.join(runDirectory, 'calibration.json'), report),
    fsp.writeFile(path.join(runDirectory, 'calibration.md'), markdown(report), 'utf8'),
  ]);
  return { report, runDirectory };
}
