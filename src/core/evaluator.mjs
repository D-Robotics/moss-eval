import fsp from 'node:fs/promises';
import path from 'node:path';
import { createAdapter } from '../adapters/index.mjs';
import { createRunner } from '../runners/index.mjs';
import { createFingerprint } from './fingerprint.mjs';
import { prepareFaults } from './faults.mjs';
import { TraceCollector } from './trace.mjs';
import { deriveTraceMetrics } from './trace-metrics.mjs';
import {
  mergeTraceWithNative,
  reconcileNativeTelemetry,
  summarizeNativeTelemetry,
  unavailableNativeTelemetry,
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
import { createRunId } from './run-id.mjs';
import { evaluateTaskEligibility, normalizeTaskRequirements } from './capabilities.mjs';

export class RunInvariantError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'RunInvariantError';
    this.code = options.code || 'RUN_INVARIANT_ERROR';
  }
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
    aborted: Boolean(processResult.aborted),
    budget_breach: processResult.budgetBreach || null,
    start_error: processResult.startError,
    output_truncated: processResult.outputTruncated,
    started_at: processResult.startedAt,
    ended_at: processResult.endedAt,
    duration_ms: processResult.durationMs,
    image_digest: processResult.imageDigest || null,
    configured_image: processResult.configuredImage || null,
    sandbox_policy: processResult.sandboxPolicy || null,
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
    aborted: error.code === 'ABORT_ERR',
    startError: { code: error.code || 'RUNNER_ERROR', message: error.message },
    stdout: '',
    stderr: '',
    outputTruncated: false,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
  };
}

export async function runTrial(options) {
  const {
    task,
    replicate,
    agentName,
    agent,
    config,
    runDir,
    allowLocal,
    runnerOverride,
    signal,
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
    signal,
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
  let adapter = null;
  try {
    faultState = await prepareFaults(task, {
      runner,
      runnerContext,
      paths,
      replicate,
    });
    initialManifest = await createManifest(workspace);
    adapter = createAdapter(agentName, agent);
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
  const nativeTelemetry = adapter
    ? await adapter.collectTelemetry(workspace, { secrets })
    : unavailableNativeTelemetry('adapter-initialization-failed');
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
  const cancelled = Boolean(processResult.aborted);
  const valid = grading.valid && !processResult.startError && !cancelled;
  const success = valid && grading.success && processPassed;
  const failureCategory = success
    ? null
    : classifyFailure({ processResult, grading, traceSummary });
  const metrics = deriveTraceMetrics(
    traceSummary,
    processResult,
    workspaceDiff,
    task.tool_expectations || null,
    task.mode,
  );
  const fingerprint = await createFingerprint(task, agentName, agent, config, runnerName, {
    imageDigest: processResult.imageDigest || null,
  });
  trace.record('trial_stop', 'evaluation', {
    task_id: task.id,
    replicate,
    status: cancelled ? 'cancelled' : valid ? (success ? 'passed' : 'failed') : 'invalid',
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
      quality_tier: task.quality_tier || 'experimental',
      capability_requirements: normalizeTaskRequirements(task),
    },
    agent: agentName,
    replicate,
    status: cancelled ? 'cancelled' : valid ? (success ? 'passed' : 'failed') : 'invalid',
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

  const persistedTrial = redactObject(trial, secrets);
  await trace.write(trialDir);
  await Promise.all([
    writeJson(path.join(trialDir, 'trial.json'), persistedTrial),
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
  return persistedTrial;
}

async function writeUnexpectedTrial(unit, error, context) {
  const { task, agentName, replicate } = unit;
  const trialDir = path.join(
    context.runDir,
    'trials',
    sanitizeId(task.id),
    sanitizeId(agentName),
    'trial-' + replicate,
  );
  const now = new Date().toISOString();
  const processResult = failedProcess(error);
  const cancelled = error.code === 'ABORT_ERR';
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
      quality_tier: task.quality_tier || 'experimental',
      capability_requirements: normalizeTaskRequirements(task),
    },
    agent: agentName,
    replicate,
    status: cancelled ? 'cancelled' : 'invalid',
    valid: false,
    success: false,
    outcome_passed: false,
    safety_passed: false,
    failure_category: cancelled ? 'cancelled' : 'infrastructure_error',
    process: processSnapshot(processResult),
    graders: [{
      id: 'trial-boundary',
      type: 'infrastructure',
      version: '1',
      required: true,
      status: 'error',
      passed: false,
      score: null,
      reason: error.message,
      details: { code: error.code || null, stage: error.stage || null },
      duration_ms: null,
    }],
    metrics: {
      tool_call_count: null,
      total_tokens: null,
      cost_usd: null,
      duration_ms: null,
      native_telemetry_available: false,
      telemetry_valid: null,
    },
    workspace_diff: { added: [], removed: [], changed: [] },
    faults: [],
    fingerprint: {
      schema_version: '1.0',
      captured_at: now,
      incomplete: true,
    },
    artifacts: {
      directory: trialDir,
      trajectory: path.join(trialDir, 'trajectory.jsonl'),
      stdout: path.join(trialDir, 'stdout.log'),
      stderr: path.join(trialDir, 'stderr.log'),
      final_response: path.join(trialDir, 'final-response.txt'),
    },
  };
  const persistedTrial = redactObject(trial, configuredSecrets(unit.agent, task));
  try {
    await writeJson(
      path.join(trialDir, 'trial.json'),
      persistedTrial,
    );
  } catch (writeError) {
    throw new RunInvariantError(
      `Unable to persist isolated trial failure for ${task.id}/${agentName}/${replicate}: ${writeError.message}`,
      { cause: writeError, code: 'ARTIFACT_STORAGE_UNAVAILABLE' },
    );
  }
  return persistedTrial;
}

export async function runPool(units, concurrency, worker, callbacks = {}) {
  let cursor = 0;
  let completed = 0;
  let fatalError = null;
  const results = [];
  async function loop() {
    while (true) {
      if (fatalError) throw fatalError;
      if (callbacks.signal?.aborted) return;
      const index = cursor++;
      if (index >= units.length) return;
      const unit = units[index];
      callbacks.onTrialStart?.(unit, index + 1, units.length);
      let result;
      try {
        result = await worker(unit);
      } catch (error) {
        if (error instanceof RunInvariantError || !callbacks.onTrialError) {
          fatalError = error;
          throw error;
        }
        try {
          result = await callbacks.onTrialError(error, unit, index + 1, units.length);
        } catch (boundaryError) {
          fatalError = boundaryError;
          throw boundaryError;
        }
      }
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
    trialExecutor = runTrial,
    signal = null,
    targetCapabilitiesByAgent = {},
  } = options;
  const runId = createRunId(label);
  const runDir = path.join(config.output_root, runId);
  await fsp.mkdir(runDir, { recursive: true });
  const units = [];
  const eligibility = [];
  for (const originalTask of tasks) {
    const task = applyEnvironmentOverrides(
      originalTask,
      config.execution.environment_overrides || null,
    );
    for (const agentName of agentNames) {
      const agent = config.agents[agentName];
      if (!agent) throw new Error('Unknown agent: ' + agentName);
      const declaredCapabilities = targetCapabilitiesByAgent[agentName] || null;
      const decision = declaredCapabilities
        ? evaluateTaskEligibility(task, declaredCapabilities)
        : {
            schema_version: '1.0',
            task_id: task.id,
            status: 'eligible',
            eligible: true,
            requirements: normalizeTaskRequirements(task),
            capabilities: null,
            missing: [],
            warning: 'target capabilities were not declared; legacy scheduling compatibility applied',
          };
      eligibility.push({
        ...decision,
        agent: agentName,
        task: {
          id: task.id,
          title: task.title,
          category: task.category,
          priority: task.priority,
          mode: task.mode,
          quality_tier: task.quality_tier || 'experimental',
        },
      });
      if (!decision.eligible) continue;
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
    eligibility,
    eligible_task_agent_count: eligibility.filter((item) => item.eligible).length,
    not_applicable_task_agent_count: eligibility.filter((item) => !item.eligible).length,
  };
  await writeJson(path.join(runDir, 'run.json'), metadata);
  await writeJson(path.join(runDir, 'eligibility.json'), {
    schema_version: '1.0',
    generated_at: metadata.created_at,
    decisions: eligibility,
  });
  onRunStart?.({ ...metadata, run_directory: runDir });
  try {
    const trials = await runPool(
      units,
      concurrency,
      (unit) =>
        trialExecutor({
          ...unit,
          config,
          runDir,
          allowLocal,
          runnerOverride,
          signal,
        }),
      {
        progress,
        onTrialStart,
        signal,
        onTrialError: (error, unit) => writeUnexpectedTrial(unit, error, { runDir }),
      },
    );
    if (signal?.aborted) {
      const cancellation = new Error('Evaluation cancelled');
      cancellation.name = 'AbortError';
      cancellation.code = 'ABORT_ERR';
      for (let index = 0; index < units.length; index++) {
        if (!trials[index]) trials[index] = await writeUnexpectedTrial(units[index], cancellation, { runDir });
      }
    }
    metadata.status = signal?.aborted ? 'cancelled' : 'completed';
    metadata.completed_at = new Date().toISOString();
    await writeJson(path.join(runDir, 'run.json'), metadata);
    return { runId, runDir, trials, metadata };
  } catch (error) {
    metadata.status = 'failed';
    metadata.completed_at = new Date().toISOString();
    metadata.failure = { code: error.code || null, message: error.message };
    try {
      await writeJson(path.join(runDir, 'run.json'), metadata);
    } catch (writeError) {
      throw new RunInvariantError(`Run metadata storage failed: ${writeError.message}`, {
        cause: writeError,
        code: 'ARTIFACT_STORAGE_UNAVAILABLE',
      });
    }
    throw error;
  }
}
