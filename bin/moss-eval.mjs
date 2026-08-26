#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { loadConfig } from '../src/core/config.mjs';
import { loadTasks, selectTasks } from '../src/core/task-loader.mjs';
import { evaluate } from '../src/core/evaluator.mjs';
import { aggregateRun } from '../src/core/aggregate.mjs';
import { compareSummaryFiles } from '../src/core/compare.mjs';
import { doctor } from '../src/core/doctor.mjs';
import { calibrateTasks } from '../src/core/calibration.mjs';
import { prepareSourceTrack } from '../src/core/source-track.mjs';
import {
  exportAgentEval,
  publishAgentEval,
} from '../src/integrations/agent-eval-service.mjs';
import { TerminalProgress } from '../src/cli/terminal-progress.mjs';
import { auditProfessionalDataset, writeAuditReport } from '../src/dataset/audit.mjs';
import { calibrateProfessionalDataset, writeCalibrationReport } from '../src/dataset/calibration.mjs';
import { buildProfessionalRelease } from '../src/dataset/release.mjs';
import { prepareCleanTargetSnapshot, resolveOfficialTarget } from '../src/dataset/target-identity.mjs';
import { auditFailureCorpus, writeFailureAuditReport } from '../src/dataset/failure-audit.mjs';
import { loadFailureCorpus } from '../src/dataset/failure-contract.mjs';
import { createTaskMapping, reproduceFailureCase } from '../src/dataset/failure-reproduction.mjs';
import { buildHiddenBundleManifest, buildProtocolManifest, evaluateReleaseEvidence, generateReviewPacket, validateSignoffs } from '../src/dataset/governance.mjs';
import { aggregateComparableRuns, qualifyAdapterFromRun } from '../src/dataset/cross-agent.mjs';
import { runHiddenOracleBundle } from '../src/dataset/hidden-release.mjs';
import { explainRunSummary } from '../src/cli/result-report.mjs';

function parseArguments(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}

function csv(value) {
  return value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : null;
}

function number(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Expected a number, got ' + value);
  return parsed;
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

async function writeJsonOutput(file, value) {
  const output = path.resolve(file);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await fsp.writeFile(output, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function usage() {
  process.stdout.write(
    [
      'moss-eval commands:',
      '  validate  --config <file>',
      '  list      --config <file> [--suite smoke]',
      '  doctor    --config <file>',
      '  calibrate --config <file> [--concurrency 4]',
      '  prepare-source [--repository <git-url>] [--ref main] [--commit <sha>]',
      '  dataset-audit     --dataset <directory> [--output <directory>]',
      '  dataset-calibrate --dataset <directory> [--output <directory>]',
      '  dataset-release   --dataset <directory> [--calibration <file>] [--pilot <file>]',
      '                    [--oracle-bundle <directory>] [--output <file>] [--expect-blocked]',
      '  failure-audit     --corpus <directory> [--output <directory>]',
      '  failure-reproduce --corpus <directory> --case <id> --authorize [--source <git-checkout>] [--write]',
      '  failure-promote   --corpus <directory> --case <id> [--task-id <id>] [--output <file>]',
      '  review-packet     --corpus <directory> --dataset <directory> --calibration <file> --output <directory>',
      '  protocol-freeze   --input <protocol-input.json> [--output <file>]',
      '  adapter-qualify   --input <qualification-input.json> [--output <file>]',
      '  cross-agent-report --protocol <file> --qualifications <file> --runs <file> [--output <file>]',
      '  hidden-manifest   --bundle <private-directory> --salt-env <environment-variable> [--output <file>]',
      '  hidden-run        --bundle <private-directory> --salt-env <environment-variable> --trials <file>',
      '                    [--expected-manifest <file>] [--output <file>]',
      '  signoff-check     --packet <file> --signoffs <file> --trusted-keys <file>',
      '  release-status    --evidence <file> [--output <file>]',
      '  target-prepare    [--repository <git-url>] [--ref refs/heads/main] --destination <directory>',
      '  run       --config <file> [--agent moss] [--suite smoke] [--trials 3]',
      '            [--runner docker|local|pty] [--allow-local]',
      '            [--progress auto|dashboard|plain|none]',
      '  aggregate --run <directory> [--k 3]',
      '  report    --run <directory> [--json] [--output <file>]',
      '  compare   --baseline <summary.json> --candidate <summary.json> [--output file]',
      '  export    --run <directory> [--output file] [--publish] [--config file]',
      '',
    ].join('\n'),
  );
}

async function configAndTasks(args) {
  if (!args.config) throw new Error('--config is required');
  const config = await loadConfig(args.config);
  const tasks = await loadTasks(config.task_roots);
  return { config, tasks };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === 'help' || args.help) {
    usage();
    return;
  }

  if (command === 'validate') {
    const { config, tasks } = await configAndTasks(args);
    printJson({
      valid: true,
      config: config._meta.file,
      task_count: tasks.length,
      agents: Object.keys(config.agents),
    });
    return;
  }

  if (command === 'prepare-source') {
    const result = await prepareSourceTrack({
      evaluationRoot: path.resolve(args.evaluationRoot || '.'),
      repository: args.repository || undefined,
      ref: args.ref || 'main',
      commit: args.commit || undefined,
      distro: args.distro || undefined,
    });
    printJson(result);
    return;
  }

  if (command === 'dataset-audit') {
    if (!args.dataset) throw new Error('--dataset is required');
    const audited = await auditProfessionalDataset(path.resolve(args.dataset));
    const output = path.resolve(args.output || path.join('.moss-eval', 'datasets', `${audited.report.dataset.id}-${audited.report.dataset.version}`, 'audit'));
    await writeAuditReport(audited.report, output);
    printJson({ ...audited.report, output });
    if (audited.report.technical_gate !== 'pass') process.exitCode = 1;
    return;
  }

  if (command === 'failure-audit') {
    if (!args.corpus) throw new Error('--corpus is required');
    const audited = await auditFailureCorpus(path.resolve(args.corpus));
    const output = path.resolve(args.output || path.join('.moss-eval', 'datasets', `${audited.report.corpus.id}-${audited.report.corpus.version}`, 'failure-audit'));
    await writeFailureAuditReport(audited.report, output);
    printJson({ ...audited.report, output });
    if (audited.report.technical_gate !== 'pass') process.exitCode = 1;
    return;
  }

  if (command === 'failure-reproduce') {
    if (!args.corpus || !args.case) throw new Error('--corpus and --case are required');
    const receipt = await reproduceFailureCase(path.resolve(args.corpus), String(args.case), {
      authorized: args.authorize === true,
      writeReceipt: args.write === true,
      sourceCheckout: args.source || undefined,
    });
    printJson(receipt);
    if (receipt.status !== 'reproduced') process.exitCode = 1;
    return;
  }

  if (command === 'failure-promote') {
    if (!args.corpus || !args.case) throw new Error('--corpus and --case are required');
    const corpus = await loadFailureCorpus(path.resolve(args.corpus));
    const record = corpus.cases.find((item) => item.id === String(args.case));
    if (!record) throw new Error(`Unknown failure case: ${args.case}`);
    const mapping = createTaskMapping(record, { taskId: args.taskId || undefined });
    if (args.output) {
      const output = path.resolve(args.output);
      await fsp.mkdir(path.dirname(output), { recursive: true });
      await fsp.writeFile(output, JSON.stringify(mapping, null, 2) + '\n', 'utf8');
    }
    printJson(mapping);
    return;
  }

  if (command === 'review-packet') {
    if (!args.corpus || !args.dataset || !args.calibration || !args.output) throw new Error('--corpus, --dataset, --calibration, and --output are required');
    const corpus = (await auditFailureCorpus(path.resolve(args.corpus))).report;
    const dataset = (await auditProfessionalDataset(path.resolve(args.dataset))).report;
    const calibration = JSON.parse(await fsp.readFile(path.resolve(args.calibration), 'utf8'));
    printJson(await generateReviewPacket({ corpusReport: corpus, datasetReport: dataset, calibrationReport: calibration, output: path.resolve(args.output) }));
    return;
  }

  if (command === 'protocol-freeze') {
    if (!args.input) throw new Error('--input is required');
    const protocol = buildProtocolManifest(JSON.parse(await fsp.readFile(path.resolve(args.input), 'utf8')));
    if (args.output) await writeJsonOutput(args.output, protocol);
    printJson(protocol); return;
  }

  if (command === 'adapter-qualify') {
    if (!args.input) throw new Error('--input is required');
    const result = qualifyAdapterFromRun(JSON.parse(await fsp.readFile(path.resolve(args.input), 'utf8')));
    if (args.output) await writeJsonOutput(args.output, result);
    printJson(result); if (!result.qualified) process.exitCode = 1; return;
  }

  if (command === 'cross-agent-report') {
    if (!args.protocol || !args.qualifications || !args.runs) throw new Error('--protocol, --qualifications, and --runs are required');
    const protocol = JSON.parse(await fsp.readFile(path.resolve(args.protocol), 'utf8'));
    const qualifications = JSON.parse(await fsp.readFile(path.resolve(args.qualifications), 'utf8'));
    const runs = JSON.parse(await fsp.readFile(path.resolve(args.runs), 'utf8'));
    const result = aggregateComparableRuns({ protocol, qualifications: qualifications.records || qualifications, runs: runs.records || runs });
    if (args.output) await writeJsonOutput(args.output, result);
    printJson(result); if (!result.comparable) process.exitCode = 1; return;
  }

  if (command === 'hidden-manifest') {
    if (!args.bundle || !args.saltEnv) throw new Error('--bundle and --salt-env are required');
    const salt = process.env[String(args.saltEnv)];
    if (!salt) throw new Error(`Environment variable ${args.saltEnv} is not set`);
    const result = await buildHiddenBundleManifest(path.resolve(args.bundle), { salt });
    if (args.output) await writeJsonOutput(args.output, result);
    printJson(result); return;
  }

  if (command === 'hidden-run') {
    if (!args.bundle || !args.saltEnv || !args.trials) throw new Error('--bundle, --salt-env, and --trials are required');
    const salt = process.env[String(args.saltEnv)];
    if (!salt) throw new Error(`Environment variable ${args.saltEnv} is not set`);
    const trialDocument = JSON.parse(await fsp.readFile(path.resolve(args.trials), 'utf8'));
    const expected = args.expectedManifest ? JSON.parse(await fsp.readFile(path.resolve(args.expectedManifest), 'utf8')) : null;
    const result = await runHiddenOracleBundle({
      bundleRoot: path.resolve(args.bundle),
      salt,
      expectedBundleDigest: expected?.bundle_digest || null,
      trials: trialDocument.records || trialDocument,
      timeoutMs: number(args.timeoutMs, 15000),
      output: args.output ? path.resolve(args.output) : null,
    });
    printJson(result); if (!result.run_passed || !result.execution_valid) process.exitCode = 1; return;
  }

  if (command === 'signoff-check') {
    if (!args.packet || !args.signoffs || !args.trustedKeys) throw new Error('--packet, --signoffs, and --trusted-keys are required');
    const packet = JSON.parse(await fsp.readFile(path.resolve(args.packet), 'utf8'));
    const signoffs = JSON.parse(await fsp.readFile(path.resolve(args.signoffs), 'utf8'));
    const trustedKeys = JSON.parse(await fsp.readFile(path.resolve(args.trustedKeys), 'utf8'));
    const result = validateSignoffs({ artifactDigest: packet.artifact_digest, signoffs: signoffs.records || signoffs, trustedKeys });
    printJson(result); if (!result.valid) process.exitCode = 1; return;
  }

  if (command === 'release-status') {
    if (!args.evidence) throw new Error('--evidence is required');
    const result = evaluateReleaseEvidence(JSON.parse(await fsp.readFile(path.resolve(args.evidence), 'utf8')));
    result.explanation = result.eligible ? '正式发布门禁全部通过。' : `当前仅可作为开发结果；仍有 ${result.blockers.length} 项发布证据未通过。`;
    if (args.output) await writeJsonOutput(args.output, result);
    printJson(result); if (!result.eligible && !args.expectBlocked) process.exitCode = 1; return;
  }

  if (command === 'dataset-calibrate') {
    if (!args.dataset) throw new Error('--dataset is required');
    const calibrated = await calibrateProfessionalDataset(path.resolve(args.dataset));
    const output = path.resolve(args.output || path.join('.moss-eval', 'datasets', `${calibrated.report.dataset.id}-${calibrated.report.dataset.version}`, 'calibration'));
    await writeCalibrationReport(calibrated.report, output);
    printJson({ ...calibrated.report, output });
    if (calibrated.report.gate !== 'pass') process.exitCode = 1;
    return;
  }

  if (command === 'dataset-release') {
    if (!args.dataset) throw new Error('--dataset is required');
    const calibration = args.calibration ? JSON.parse(await fsp.readFile(path.resolve(args.calibration), 'utf8')) : null;
    const pilot = args.pilot ? JSON.parse(await fsp.readFile(path.resolve(args.pilot), 'utf8')) : null;
    const released = await buildProfessionalRelease(path.resolve(args.dataset), {
      calibration,
      pilot,
      oracleBundle: args.oracleBundle ? path.resolve(args.oracleBundle) : null,
      output: args.output ? path.resolve(args.output) : null,
    });
    printJson(released.result);
    if (args.expectBlocked) {
      if (released.result.release_eligible) process.exitCode = 1;
    } else if (!released.result.release_eligible) process.exitCode = 1;
    return;
  }

  if (command === 'target-prepare') {
    if (!args.destination) throw new Error('--destination is required');
    const identity = await resolveOfficialTarget({ repository: args.repository || undefined, ref: args.ref || undefined });
    const snapshot = await prepareCleanTargetSnapshot(identity, path.resolve(args.destination));
    printJson(snapshot);
    if (!snapshot.official) process.exitCode = 1;
    return;
  }

  if (command === 'list') {
    const { tasks } = await configAndTasks(args);
    const selected = selectTasks(tasks, {
      suite: args.suite || null,
      ids: csv(args.task),
      categories: csv(args.category),
      priorities: csv(args.priority),
      includeDisabled: Boolean(args.includeDisabled),
    });
    printJson(
      selected.map((task) => ({
        id: task.id,
        version: task.version,
        title: task.title,
        category: task.category,
        priority: task.priority,
        mode: task.mode,
        suites: task.suites,
        enabled: task.enabled,
      })),
    );
    return;
  }

  if (command === 'doctor') {
    const { config } = await configAndTasks(args);
    const result = await doctor(config);
    printJson(result);
    if (!result.ready) process.exitCode = 1;
    return;
  }

  if (command === 'calibrate') {
    const { config, tasks } = await configAndTasks(args);
    const selected = selectTasks(tasks, {
      suite: args.suite || null,
      ids: csv(args.task),
      categories: csv(args.category),
      priorities: csv(args.priority),
    });
    if (selected.length === 0) throw new Error('No tasks matched the selection');
    const result = await calibrateTasks(selected, {
      outputRoot: path.join(config.output_root, '..', 'calibration'),
      concurrency: number(args.concurrency, 4),
    });
    printJson({
      gate: result.report.gate,
      task_count: result.report.task_count,
      control_count: result.report.control_count,
      reference_false_negative_rate: result.report.reference_false_negative_rate,
      negative_false_positive_rate: result.report.negative_false_positive_rate,
      output: result.runDirectory,
    });
    if (result.report.gate !== 'pass') process.exitCode = 1;
    return;
  }

  if (command === 'run') {
    const { config, tasks } = await configAndTasks(args);
    const selected = selectTasks(tasks, {
      suite: args.suite || null,
      ids: csv(args.task),
      categories: csv(args.category),
      priorities: csv(args.priority),
    });
    if (selected.length === 0) throw new Error('No tasks matched the selection');
    const agentNames = csv(args.agent) || Object.keys(config.agents);
    const terminal = new TerminalProgress({ mode: args.progress || 'auto' });
    let run;
    try {
      run = await evaluate({
        tasks: selected,
        agentNames,
        config,
        label: args.label || args.suite || 'run',
        trialsOverride: number(args.trials),
        concurrency: number(args.concurrency, config.execution.concurrency),
        allowLocal: Boolean(args.allowLocal),
        runnerOverride: args.runner || null,
        onRunStart: (metadata) => terminal.onRunStart(metadata),
        onTrialStart: (unit) => terminal.onTrialStart(unit),
        progress: (trial, completed, total) => terminal.onTrialComplete(trial, completed, total),
      });
    } finally {
      terminal.finish();
    }
    const summary = await aggregateRun(run.runDir, { k: number(args.k, config.execution.k) });
    await exportAgentEval(run.runDir);
    printJson({ run_id: run.runId, run_directory: run.runDir, summary });
    if (run.trials.some((trial) => !trial.success)) process.exitCode = 1;
    return;
  }

  if (command === 'aggregate') {
    if (!args.run) throw new Error('--run is required');
    printJson(await aggregateRun(path.resolve(args.run), { k: number(args.k, 3) }));
    return;
  }

  if (command === 'report') {
    if (!args.run) throw new Error('--run is required');
    const runDirectory = path.resolve(args.run);
    const summary = JSON.parse(await fsp.readFile(path.join(runDirectory, 'summary.json'), 'utf8'));
    const releaseDecision = await fsp.readFile(path.join(runDirectory, 'release-decision.json'), 'utf8').then(JSON.parse).catch(() => null);
    const report = explainRunSummary(summary, releaseDecision);
    if (args.output) await writeJsonOutput(args.output, report);
    if (args.json) printJson(report); else process.stdout.write(report.lines.join('\n') + '\n');
    return;
  }

  if (command === 'compare') {
    if (!args.baseline || !args.candidate) {
      throw new Error('--baseline and --candidate are required');
    }
    const comparison = await compareSummaryFiles(
      path.resolve(args.baseline),
      path.resolve(args.candidate),
      args.output ? path.resolve(args.output) : null,
      { validTrialThreshold: number(args.validTrialThreshold, 0.95) },
    );
    printJson(comparison);
    if (comparison.gate === 'red') process.exitCode = 2;
    else if (comparison.gate === 'yellow') process.exitCode = 1;
    return;
  }

  if (command === 'export') {
    if (!args.run) throw new Error('--run is required');
    const exported = await exportAgentEval(
      path.resolve(args.run),
      args.output ? path.resolve(args.output) : null,
    );
    let published = null;
    if (args.publish) {
      if (!args.config) throw new Error('--config is required with --publish');
      const config = await loadConfig(args.config);
      published = await publishAgentEval(
        exported.payload,
        config.integrations?.agent_eval_service,
      );
    }
    printJson({ output: exported.target, cases: exported.payload.cases.length, published });
    return;
  }

  throw new Error('Unknown command: ' + command);
}

main().catch((error) => {
  if (String(process.argv[2] || '').startsWith('failure-')) {
    process.stderr.write(JSON.stringify({
      ok: false,
      command: process.argv[2],
      error: { code: error.code || 'FAILURE_COMMAND_ERROR', message: error.message },
    }, null, 2) + '\n');
  } else process.stderr.write('ERROR: ' + error.message + '\n');
  process.exitCode = 1;
});
