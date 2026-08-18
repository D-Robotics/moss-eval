import fsp from 'node:fs/promises';
import path from 'node:path';
import { createAdapter } from '../adapters/index.mjs';
import { createRunner } from '../runners/index.mjs';
import { createFingerprint } from './fingerprint.mjs';
import { prepareFaults } from './faults.mjs';
import { TraceCollector } from './trace.mjs';
import { deriveTraceMetrics } from './trace-metrics.mjs';
import {
  collectMossNativeTelemetry,
  mergeTraceWithNative,
  reconcileNativeTelemetry,
  summarizeNativeTelemetry,
} from './native-telemetry.mjs';
import { classifyFailure } from './failure.mjs';
import { runGraders } from '../verifiers/index.mjs';
import {
  copyFixture,
  createManifest,
  diffManifests,
  sanitizeId,
} from '../lib/paths.mjs';
import { redactObject, writeJson } from '../lib/json.mjs';

function runIdentifier(label = 'run') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  return sanitizeId(stamp + '-' + label);
}

function configuredSecrets(agent, task) {
  const values = [];
  for (const name of agent.secret_env || []) {
    const value = process.env[name];
    if (value) values.push(value);
  }
  for (const assertion of task.fatal_assertions || []) {
    if (assertion.type === 'no_secret_leak') values.push(...(assertion.canaries || []));
  }
  return values;
}

function processSnapshot(processResult) {
  return {
    command: processResult.command,
    args: processResult.args,
    cwd: processResult.cwd,
    exit_code: processResult.exitCode,
    signal: processResult.signal,
    timed_out: processResult.timedOut,
    start_error: processResult.startError,
    output_truncated: processResult.outputTruncated,
    started_at: processResult.startedAt,
    ended_at: processResult.endedAt,
    duration_ms: processResult.durationMs,
    image_digest: processResult.imageDigest || null,
    configured_image: processResult.configuredImage || null,
  };
}

function applyEnvironmentOverrides(task, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return task;
  const runtimeTask = structuredClone(task);
  runtimeTask._meta = task._meta;
  runtimeTask.environment = { ...task.environment, ...overrides };
  runtimeTask._runtime_overrides = { environment: structuredClone(overrides) };
  return runtimeTask;
}

function failedProcess(error) {
  const now = new Date().toISOString();
  return {
    command: null,
    args: [],
    cwd: null,
    exitCode: null,
    signal: null,
    timedOut: false,
    startError: { code: error.code || 'RUNNER_ERROR', message: error.message },
    stdout: '',
    stderr: '',
    outputTruncated: false,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
  };
}

async function runTrial(options) {
  const {
    task,
    replicate,
    agentName,
    agent,
    config,
    runDir,
    allowLocal,
    runnerOverride,
  } = options;
  const taskSegment = sanitizeId(task.id);
  const agentSegment = sanitizeId(agentName);
  const trialDir = path.join(runDir, 'trials', taskSegment, agentSegment, 'trial-' + replicate);
  const workspace = path.join(trialDir, 'workspace');
  await fsp.mkdir(trialDir, { recursive: true });
  await copyFixture(task.environment.fixture, workspace);

  const runnerName = runnerOverride || task.environment.runner || config.default_runner;
  const runner = createRunner(runnerName, config.runners, { allowLocal });
  const taskDir = task._meta.directory;
  const runnerContext = {
    task,
    replicate,
    workspace,
    taskDir,
    runDir,
    trialDir,
    evalRoot: config._meta.evaluationRoot,
  };
  const paths = runner.paths(runnerContext);
  const secrets = configuredSecrets(agent, task);
  const trace = new TraceCollector({ secrets });
  trace.record('trial_start', 'evaluation', {
    task_id: task.id,
    task_version: task.version,
    replicate,
    agent: agentName,
    runner: runnerName,
  });

  let faultState = { environment: {}, results: [] };
  let processResult;
  let initialManifest = [];
  try {
    faultState = await prepareFaults(task, {
      runner,
      runnerContext,
      paths,
      replicate,
    });
    initialManifest = await createManifest(workspace);
    const adapter = createAdapter(agentName, agent);
    const command = adapter.build(task, {
      paths,
      replicate,
      faultEnvironment: faultState.environment,
    });
    trace.record('agent_start', 'evaluation', {
      command: command.command,
      args: command.args,
      metadata: command.metadata,
    });
    processResult = await runner.run(command, {
      ...runnerContext,
      timeoutMs: task.environment.timeout_seconds * 1000,
      onStdout: (chunk) => trace.ingestStdout(chunk),
      onStderr: (chunk) => trace.ingestStderr(chunk),
    });
  } catch (error) {
    processResult = failedProcess(error);
    trace.record('runner_error', 'evaluation', { message: error.message, code: error.code || null });
  }

  trace.finish();
  trace.record('agent_stop', 'evaluation', {
    exit_code: processResult.exitCode,
    timed_out: processResult.timedOut,
    start_error: processResult.startError,
  });
  const finalManifest = await createManifest(workspace);
  const workspaceDiff = diffManifests(initialManifest, finalManifest);
  const genericTraceSummary = trace.summary();
  const nativeTelemetry = await collectMossNativeTelemetry(workspace, { secrets });
  const telemetryReconciliation = reconcileNativeTelemetry(
    genericTraceSummary,
    nativeTelemetry,
    { mode: task.mode },
  );
  const traceSummary = mergeTraceWithNative(
    genericTraceSummary,
    nativeTelemetry,
    telemetryReconciliation,
  );
  const telemetrySummary = summarizeNativeTelemetry(
    nativeTelemetry,
    telemetryReconciliation,
  );
  const gradingContext = {
    task,
    replicate,
    workspace,
    workspaceDiff,
    trace,
    traceSummary,
    runner,
    runnerContext,
    paths,
    judge: config.judge || null,
    processResult,
    outcomeResults: [],
  };
  const grading = await runGraders(task, gradingContext);
  for (const result of grading.results) {
    trace.record('verifier_result', 'grader', result);
  }
  const allowedExitCodes = task.environment.allowed_agent_exit_codes || [0];
  const processPassed =
    !processResult.startError &&
    !processResult.timedOut &&
    allowedExitCodes.includes(processResult.exitCode);
  const valid = grading.valid && !processResult.startError;
  const success = valid && grading.success && processPassed;
  const failureCategory = success
    ? null
    : classifyFailure({ processResult, grading, traceSummary });
  const metrics = deriveTraceMetrics(
    traceSummary,
    processResult,
    workspaceDiff,
    task.tool_expectations || null,
  );
  const fingerprint = await createFingerprint(task, agentName, agent, config, runnerName, {
    imageDigest: processResult.imageDigest || null,
  });
  trace.record('trial_stop', 'evaluation', {
    task_id: task.id,
    replicate,
    status: valid ? (success ? 'passed' : 'failed') : 'invalid',
    failure_category: failureCategory,
  });

  const trial = {
    schema_version: '1.0',
    task: {
      id: task.id,
      version: String(task.version),
      title: task.title,
      instruction: task.instruction,
      expected_answer: task.expected_answer || null,
      expected_tool_calls: task.expected_tool_calls || [],
      tool_expectations: task.tool_expectations || null,
      category: task.category,
      priority: task.priority,
      mode: task.mode,
      suites: task.suites,
    },
    agent: agentName,
    replicate,
    status: valid ? (success ? 'passed' : 'failed') : 'invalid',
    valid,
    success,
    outcome_passed: grading.outcomePassed,
    safety_passed: grading.safetyPassed,
    failure_category: failureCategory,
    process: processSnapshot(processResult),
    graders: grading.results,
    metrics,
    workspace_diff: workspaceDiff,
    faults: faultState.results,
    fingerprint,
    artifacts: {
      directory: trialDir,
      trajectory: path.join(trialDir, 'trajectory.jsonl'),
      stdout: path.join(trialDir, 'stdout.log'),
      stderr: path.join(trialDir, 'stderr.log'),
      final_response: path.join(trialDir, 'final-response.txt'),
      native_telemetry: path.join(trialDir, 'native-telemetry.json'),
      telemetry_summary: path.join(trialDir, 'telemetry-summary.json'),
      telemetry_mismatches: path.join(trialDir, 'telemetry-mismatches.json'),
    },
  };

  await trace.write(trialDir);
  await Promise.all([
    writeJson(path.join(trialDir, 'trial.json'), redactObject(trial, secrets)),
    writeJson(path.join(trialDir, 'initial-manifest.json'), initialManifest),
    writeJson(path.join(trialDir, 'final-manifest.json'), finalManifest),
    writeJson(path.join(trialDir, 'native-telemetry.json'), redactObject(nativeTelemetry, secrets)),
    writeJson(path.join(trialDir, 'telemetry-summary.json'), telemetrySummary),
    writeJson(path.join(trialDir, 'telemetry-mismatches.json'), {
      schema_version: '1.0',
      valid: telemetryReconciliation.valid,
      mismatches: telemetryReconciliation.mismatches,
    }),
  ]);
  return trial;
}

async function runPool(units, concurrency, worker, callbacks = {}) {
  let cursor = 0;
  let completed = 0;
  const results = [];
  async function loop() {
    while (true) {
      const index = cursor++;
      if (index >= units.length) return;
      const unit = units[index];
      callbacks.onTrialStart?.(unit, index + 1, units.length);
      const result = await worker(unit);
      results[index] = result;
      completed += 1;
      callbacks.progress?.(result, completed, units.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, loop));
  return results;
}

export async function evaluate(options) {
  const {
    tasks,
    agentNames,
    config,
    label = 'run',
    trialsOverride = null,
    concurrency = config.execution.concurrency || 1,
    allowLocal = false,
    runnerOverride = null,
    progress = null,
    onRunStart = null,
    onTrialStart = null,
  } = options;
  const runId = runIdentifier(label);
  const runDir = path.join(config.output_root, runId);
  await fsp.mkdir(runDir, { recursive: true });
  const units = [];
  for (const originalTask of tasks) {
    const task = applyEnvironmentOverrides(
      originalTask,
      config.execution.environment_overrides || null,
    );
    for (const agentName of agentNames) {
      const agent = config.agents[agentName];
      if (!agent) throw new Error('Unknown agent: ' + agentName);
      const trials = trialsOverride || config.execution.trials || task.trials;
      for (let replicate = 1; replicate <= trials; replicate++) {
        units.push({ task, agentName, agent, replicate });
      }
    }
  }

  const metadata = {
    schema_version: '1.0',
    run_id: runId,
    created_at: new Date().toISOString(),
    status: 'running',
    task_count: tasks.length,
    agent_names: agentNames,
    trial_count: units.length,
  };
  await writeJson(path.join(runDir, 'run.json'), metadata);
  onRunStart?.({ ...metadata, run_directory: runDir });
  const trials = await runPool(
    units,
    concurrency,
    (unit) =>
      runTrial({
        ...unit,
        config,
        runDir,
        allowLocal,
        runnerOverride,
      }),
    { progress, onTrialStart },
  );
  metadata.status = 'completed';
  metadata.completed_at = new Date().toISOString();
  await writeJson(path.join(runDir, 'run.json'), metadata);
  return { runId, runDir, trials, metadata };
}
