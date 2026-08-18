import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from '../lib/json.mjs';

async function discoverTrials(directory, output) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await discoverTrials(absolute, output);
    else if (entry.isFile() && entry.name === 'trial.json') output.push(absolute);
  }
}

export async function loadRunTrials(runDirectory) {
  const root = path.join(runDirectory, 'trials');
  const files = [];
  try {
    await discoverTrials(root, files);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return Promise.all(files.map(readJson));
}

export function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { low: null, high: null };
  const probability = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (probability + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((probability * (1 - probability)) / total + (z * z) / (4 * total * total));
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function rate(successes, total) {
  return {
    successes,
    total,
    value: total ? successes / total : null,
    confidence_95: wilsonInterval(successes, total),
  };
}

function percentile(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(proportion * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function groupBy(items, keyFunction) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFunction(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

function taskRollups(trials, k) {
  const groups = groupBy(trials, (trial) => trial.task.id);
  const tasks = [];
  for (const taskTrials of groups.values()) {
    taskTrials.sort((left, right) => left.replicate - right.replicate);
    const firstK = taskTrials.filter((trial) => trial.replicate <= k);
    const eligibleK = firstK.length === k && firstK.every((trial) => trial.valid);
    const first = taskTrials.find((trial) => trial.replicate === 1);
    tasks.push({
      id: taskTrials[0].task.id,
      title: taskTrials[0].task.title,
      category: taskTrials[0].task.category,
      priority: taskTrials[0].task.priority,
      mode: taskTrials[0].task.mode,
      pass_1_eligible: Boolean(first?.valid),
      pass_1: Boolean(first?.valid && first.success),
      pass_at_k_eligible: eligibleK,
      pass_at_k: eligibleK ? firstK.some((trial) => trial.success) : null,
      pass_pow_k: eligibleK ? firstK.every((trial) => trial.success) : null,
      valid_trials: taskTrials.filter((trial) => trial.valid).length,
      total_trials: taskTrials.length,
    });
  }
  tasks.sort((left, right) => left.id.localeCompare(right.id));
  return tasks;
}

function summarizeAgent(agent, trials, k) {
  const valid = trials.filter((trial) => trial.valid);
  const passed = valid.filter((trial) => trial.success);
  const tracks = [...new Set(trials.map((trial) => trial.fingerprint?.track || 'release'))];
  const sourceCommits = [...new Set(
    trials.map((trial) => trial.fingerprint?.source?.commit).filter(Boolean),
  )];
  const imageDigests = [...new Set(
    trials.map((trial) => trial.fingerprint?.image_digest).filter(Boolean),
  )];
  const taskResults = taskRollups(trials, k);
  const pass1Eligible = taskResults.filter((task) => task.pass_1_eligible);
  const passKEligible = taskResults.filter((task) => task.pass_at_k_eligible);
  const safetyViolations = valid.filter((trial) => !trial.safety_passed);
  const recoveryTrials = valid.filter((trial) => (trial.faults || []).length > 0);
  const failures = {};
  for (const trial of trials) {
    if (!trial.failure_category) continue;
    failures[trial.failure_category] = (failures[trial.failure_category] || 0) + 1;
  }

  const categoryGroups = groupBy(pass1Eligible, (task) => task.category);
  const categories = [...categoryGroups.entries()].map(([category, tasks]) => ({
    category,
    pass_1: rate(tasks.filter((task) => task.pass_1).length, tasks.length),
  }));
  categories.sort((left, right) => left.category.localeCompare(right.category));
  const categoryValues = categories
    .map((item) => item.pass_1.value)
    .filter((value) => value !== null);

  const totalCost = valid.reduce((sum, trial) => sum + (trial.metrics.cost_usd || 0), 0);
  const successfulDurations = passed
    .map((trial) => trial.metrics.duration_ms)
    .filter(Number.isFinite);
  const telemetryAvailable = trials.filter((trial) => trial.metrics.native_telemetry_available);
  const telemetryTrusted = telemetryAvailable.filter((trial) => trial.metrics.telemetry_valid === true);
  const trustedProcessTrials = trials.filter((trial) => trial.metrics.telemetry_valid !== false);
  const qualityEligible = trustedProcessTrials.filter(
    (trial) => trial.metrics.tool_quality?.eligible,
  );
  const totalToolCalls = trustedProcessTrials.reduce(
    (sum, trial) => sum + (trial.metrics.tool_call_count || 0),
    0,
  );
  const totalToolErrors = trustedProcessTrials.reduce(
    (sum, trial) => sum + (trial.metrics.tool_execution_failure_count || 0),
    0,
  );
  const durationRecords = trustedProcessTrials.reduce(
    (sum, trial) => sum + (trial.metrics.tool_duration_ms?.records || 0),
    0,
  );
  const totalToolDuration = trustedProcessTrials.reduce(
    (sum, trial) => sum + (trial.metrics.tool_duration_ms?.total || 0),
    0,
  );
  return {
    agent,
    track: tracks.length === 1 ? tracks[0] : 'mixed',
    source_commit: sourceCommits.length === 1 ? sourceCommits[0] : null,
    image_digests: imageDigests,
    k,
    valid_trial_rate: rate(valid.length, trials.length),
    outcome_pass_rate: rate(
      valid.filter((trial) => trial.outcome_passed).length,
      valid.length,
    ),
    trial_success_rate: rate(passed.length, valid.length),
    pass_at_1: rate(
      pass1Eligible.filter((task) => task.pass_1).length,
      pass1Eligible.length,
    ),
    pass_at_k: rate(
      passKEligible.filter((task) => task.pass_at_k).length,
      passKEligible.length,
    ),
    pass_pow_k: rate(
      passKEligible.filter((task) => task.pass_pow_k).length,
      passKEligible.length,
    ),
    safety_violation_rate: rate(safetyViolations.length, valid.length),
    recovery_success_rate: rate(
      recoveryTrials.filter((trial) => trial.success).length,
      recoveryTrials.length,
    ),
    category_macro_pass_at_1:
      categoryValues.length > 0
        ? categoryValues.reduce((sum, value) => sum + value, 0) / categoryValues.length
        : null,
    categories,
    cost: {
      total_usd: totalCost,
      per_successful_trial_usd: passed.length ? totalCost / passed.length : null,
    },
    latency_ms: {
      p50: percentile(successfulDurations, 0.5),
      p95: percentile(successfulDurations, 0.95),
    },
    telemetry: {
      native_available_rate: rate(telemetryAvailable.length, trials.length),
      valid_rate: rate(telemetryTrusted.length, telemetryAvailable.length),
      mismatch_count: trials.reduce(
        (sum, trial) => sum + (trial.metrics.telemetry_mismatch_count || 0),
        0,
      ),
    },
    tools: {
      trusted_trial_count: trustedProcessTrials.length,
      total_calls: totalToolCalls,
      execution_failure_rate: totalToolCalls ? totalToolErrors / totalToolCalls : null,
      duration_records: durationRecords,
      average_duration_ms: durationRecords ? totalToolDuration / durationRecords : null,
      quality: {
        eligible_trials: qualityEligible.length,
        macro_precision: mean(qualityEligible.map((trial) => trial.metrics.tool_quality.precision)),
        macro_recall: mean(qualityEligible.map((trial) => trial.metrics.tool_quality.recall)),
        macro_f1: mean(qualityEligible.map((trial) => trial.metrics.tool_quality.f1)),
        policy_pass_rate: rate(
          qualityEligible.filter((trial) => trial.metrics.tool_quality.policy_passed).length,
          qualityEligible.length,
        ),
      },
    },
    failure_categories: failures,
    tasks: taskResults,
  };
}

export function aggregateTrials(trials, options = {}) {
  const k = options.k || 3;
  const groups = groupBy(trials, (trial) => trial.agent);
  const agents = [...groups.entries()].map(([agent, values]) =>
    summarizeAgent(agent, values, k),
  );
  agents.sort((left, right) => left.agent.localeCompare(right.agent));
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    k,
    trial_count: trials.length,
    agent_count: agents.length,
    agents,
  };
}

export async function aggregateRun(runDirectory, options = {}) {
  const trials = await loadRunTrials(runDirectory);
  const summary = aggregateTrials(trials, options);
  await writeJson(path.join(runDirectory, 'summary.json'), summary);
  return summary;
}
