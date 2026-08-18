#!/usr/bin/env node
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

function usage() {
  process.stdout.write(
    [
      'moss-eval commands:',
      '  validate  --config <file>',
      '  list      --config <file> [--suite smoke]',
      '  doctor    --config <file>',
      '  calibrate --config <file> [--concurrency 4]',
      '  prepare-source [--repository <git-url>] [--ref main] [--commit <sha>]',
      '  run       --config <file> [--agent moss] [--suite smoke] [--trials 3]',
      '            [--runner docker|local|pty] [--allow-local]',
      '            [--progress auto|dashboard|plain|none]',
      '  aggregate --run <directory> [--k 3]',
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
  process.stderr.write('ERROR: ' + error.message + '\n');
  process.exitCode = 1;
});
