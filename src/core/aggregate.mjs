import path from 'node:path';
import { writeJson } from '../lib/json.mjs';
import { loadRunTrials } from './artifacts.mjs';
import { readRunMetadata } from './artifacts.mjs';

export { loadRunTrials } from './artifacts.mjs';

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

function taskRollups(trials, k, eligibility = []) {
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
      quality_tier: taskTrials[0].task.quality_tier || 'experimental',
      pass_1_eligible: Boolean(first?.valid),
      pass_1: Boolean(first?.valid && first.success),
      pass_at_k_eligible: eligibleK,
      pass_at_k: eligibleK ? firstK.some((trial) => trial.success) : null,
      pass_pow_k: eligibleK ? firstK.every((trial) => trial.success) : null,
      valid_trials: taskTrials.filter((trial) => trial.valid).length,
      total_trials: taskTrials.length,
      applicability: 'eligible',
      missing_capabilities: [],
    });
  }
  for (const decision of eligibility.filter((item) => !item.eligible)) {
    if (tasks.some((task) => task.id === decision.task_id)) continue;
    tasks.push({
      id: decision.task_id,
      title: decision.task?.title || decision.task_id,
      category: decision.task?.category || null,
      priority: decision.task?.priority || null,
      mode: decision.task?.mode || null,
      quality_tier: decision.task?.quality_tier || 'experimental',
      applicability: 'NOT_APPLICABLE',
      missing_capabilities: decision.missing || [],
      pass_1_eligible: false,
      pass_1: null,
      pass_at_k_eligible: false,
      pass_at_k: null,
      pass_pow_k: null,
      valid_trials: 0,
      total_trials: 0,
    });
  }
  tasks.sort((left, right) => left.id.localeCompare(right.id));
  return tasks;
}

function summarizeAgent(agent, trials, k, eligibility = []) {
  const valid = trials.filter((trial) => trial.valid);
  const passed = valid.filter((trial) => trial.success);
  const tracks = [...new Set(trials.map((trial) => trial.fingerprint?.track || 'release'))];
  const sourceCommits = [...new Set(
    trials.map((trial) => trial.fingerprint?.source?.commit).filter(Boolean),
  )];
  const sourceSnapshotFingerprints = [...new Set(
    trials.map((trial) => trial.fingerprint?.source?.snapshot_fingerprint).filter(Boolean),
  )];
  const imageDigests = [...new Set(
    trials.map((trial) => trial.fingerprint?.image_digest).filter(Boolean),
  )];
  const preparedTargetFingerprints = [...new Set(
    trials.map((trial) => trial.fingerprint?.prepared_target?.fingerprint).filter(Boolean),
  )];
  const adapterProvenance = [...new Map(
    trials.map((trial) => trial.fingerprint?.prepared_target?.adapter).filter(Boolean).map((adapter) => [`${adapter.id}@${adapter.version}`, adapter]),
  ).values()];
  const taskResults = taskRollups(trials, k, eligibility);
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

  const costKnown = valid.filter((trial) => Number.isFinite(trial.metrics.cost_usd));
  const knownTotalCost = costKnown.reduce((sum, trial) => sum + trial.metrics.cost_usd, 0);
  const successfulCostKnown = passed.filter((trial) => Number.isFinite(trial.metrics.cost_usd));
  const successfulDurations = passed
    .map((trial) => trial.metrics.duration_ms)
    .filter(Number.isFinite);
  const tokenKnown = valid.filter((trial) => Number.isFinite(trial.metrics.total_tokens));
  const knownTotalTokens = tokenKnown.reduce((sum, trial) => sum + trial.metrics.total_tokens, 0);
  const telemetryAvailable = trials.filter((trial) => trial.metrics.native_telemetry_available);
  const telemetryTrusted = telemetryAvailable.filter((trial) => trial.metrics.telemetry_valid === true);
  const toolTelemetryTrials = trials.filter((trial) =>
    trial.metrics.metric_availability?.tools?.available ??
      (trial.metrics.tool_call_count !== null && trial.metrics.tool_call_count !== undefined),
  );
  const trustedProcessTrials = toolTelemetryTrials.filter((trial) => trial.metrics.telemetry_valid !== false);
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
  const telemetryLevelCounts = { L0: 0, L1: 0, L2: 0, L3: 0 };
  for (const trial of trials) {
    const level = trial.metrics.telemetry_level || 'L0';
    telemetryLevelCounts[level] = (telemetryLevelCounts[level] || 0) + 1;
  }
  const lifecycleEligible = trials.filter((trial) => trial.metrics.metric_availability?.lifecycle?.available);
  const notApplicable = taskResults.filter((task) => task.applicability === 'NOT_APPLICABLE');
  const applicable = taskResults.filter((task) => task.applicability !== 'NOT_APPLICABLE');
  const qualityTrack = (tier) => {
    const tierTasks = taskResults.filter((task) => task.quality_tier === tier);
    const tierEligible = tierTasks.filter((task) => task.pass_1_eligible);
    const tierTrials = trials.filter((trial) => (trial.task.quality_tier || 'experimental') === tier);
    const tierValid = tierTrials.filter((trial) => trial.valid);
    return {
      task_count: tierTasks.length,
      coverage: { eligible_rate: rate(tierTasks.filter((task) => task.applicability !== 'NOT_APPLICABLE').length, tierTasks.length) },
      valid_trial_rate: rate(tierValid.length, tierTrials.length),
      outcome_pass_rate: rate(tierValid.filter((trial) => trial.outcome_passed).length, tierValid.length),
      pass_at_1: rate(tierEligible.filter((task) => task.pass_1).length, tierEligible.length),
      safety_violation_rate: rate(tierValid.filter((trial) => !trial.safety_passed).length, tierValid.length),
    };
  };
  return {
    agent,
    track: tracks.length === 1 ? tracks[0] : 'mixed',
    source_commit: sourceCommits.length === 1 ? sourceCommits[0] : null,
    source_snapshot_fingerprints: sourceSnapshotFingerprints,
    image_digests: imageDigests,
    prepared_target_fingerprints: preparedTargetFingerprints,
    adapters: adapterProvenance,
    k,
    coverage: {
      total_tasks: taskResults.length,
      eligible_tasks: applicable.length,
      not_applicable_tasks: notApplicable.length,
      eligible_rate: rate(applicable.length, taskResults.length),
      not_applicable: notApplicable.map((task) => ({
        id: task.id,
        missing_capabilities: task.missing_capabilities,
      })),
    },
    quality_tracks: {
      gated: qualityTrack('gated'),
      experimental: qualityTrack('experimental'),
    },
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
      total_usd: costKnown.length === valid.length && valid.length > 0 ? knownTotalCost : null,
      known_total_usd: costKnown.length > 0 ? knownTotalCost : null,
      per_successful_trial_usd:
        passed.length > 0 && successfulCostKnown.length === passed.length
          ? successfulCostKnown.reduce((sum, trial) => sum + trial.metrics.cost_usd, 0) / passed.length
          : null,
      coverage: rate(costKnown.length, valid.length),
      unknown_trial_count: valid.length - costKnown.length,
    },
    latency_ms: {
      p50: percentile(successfulDurations, 0.5),
      p95: percentile(successfulDurations, 0.95),
      coverage: rate(successfulDurations.length, passed.length),
      unknown_trial_count: passed.length - successfulDurations.length,
    },
    tokens: {
      total: tokenKnown.length === valid.length && valid.length > 0 ? knownTotalTokens : null,
      known_total: tokenKnown.length > 0 ? knownTotalTokens : null,
      coverage: rate(tokenKnown.length, valid.length),
      unknown_trial_count: valid.length - tokenKnown.length,
    },
    telemetry: {
      achieved_level_counts: telemetryLevelCounts,
      native_available_rate: rate(telemetryAvailable.length, trials.length),
      valid_rate: rate(telemetryTrusted.length, telemetryAvailable.length),
      mismatch_count: trials.reduce(
        (sum, trial) => sum + (trial.metrics.telemetry_mismatch_count || 0),
        0,
      ),
    },
    tools: {
      coverage: rate(toolTelemetryTrials.length, trials.length),
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
    lifecycle: {
      coverage: rate(lifecycleEligible.length, trials.length),
      retries: lifecycleEligible.length
        ? lifecycleEligible.reduce((sum, trial) => sum + (trial.metrics.retry_count || 0), 0)
        : null,
      context_compactions: lifecycleEligible.length
        ? lifecycleEligible.reduce((sum, trial) => sum + (trial.metrics.context_compaction_count || 0), 0)
        : null,
      subagent_spawns: lifecycleEligible.length
        ? lifecycleEligible.reduce((sum, trial) => sum + (trial.metrics.subagent_spawn_count || 0), 0)
        : null,
    },
    failure_categories: failures,
    tasks: taskResults,
  };
}

export function aggregateTrials(trials, options = {}) {
  const k = options.k || 3;
  const groups = groupBy(trials, (trial) => trial.agent);
  const eligibility = options.eligibility || [];
  const agentNames = new Set([...groups.keys(), ...eligibility.map((item) => item.agent).filter(Boolean)]);
  const agents = [...agentNames].map((agent) =>
    summarizeAgent(
      agent,
      groups.get(agent) || [],
      k,
      eligibility.filter((item) => item.agent === agent),
    ),
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
  const metadata = await readRunMetadata(runDirectory, { optional: true });
  const summary = aggregateTrials(trials, {
    ...options,
    eligibility: options.eligibility || metadata?.eligibility || [],
  });
  await writeJson(path.join(runDirectory, 'summary.json'), summary);
  return summary;
}
