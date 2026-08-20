import { readJson, writeJson } from '../lib/json.mjs';

function byAgent(summary) {
  return new Map(summary.agents.map((agent) => [agent.agent, agent]));
}

function taskMap(agentSummary) {
  return new Map(agentSummary.tasks.map((task) => [task.id, task]));
}

function value(metric) {
  return metric?.value ?? null;
}

function delta(current, previous) {
  return Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null;
}

function commonTaskMetric(previousTasks, currentTasks, field, eligibilityField) {
  const pairs = [];
  for (const [taskId, current] of currentTasks) {
    const previous = previousTasks.get(taskId);
    if (!previous || previous.applicability === 'NOT_APPLICABLE' || current.applicability === 'NOT_APPLICABLE') continue;
    if (!previous[eligibilityField] || !current[eligibilityField]) continue;
    pairs.push({ taskId, previous: Boolean(previous[field]), current: Boolean(current[field]) });
  }
  const previousValue = pairs.length
    ? pairs.filter((pair) => pair.previous).length / pairs.length
    : null;
  const currentValue = pairs.length
    ? pairs.filter((pair) => pair.current).length / pairs.length
    : null;
  return {
    common_task_count: pairs.length,
    task_ids: pairs.map((pair) => pair.taskId).sort(),
    baseline: previousValue,
    candidate: currentValue,
    delta: delta(currentValue, previousValue),
  };
}

export function compareSummaries(baseline, candidate, options = {}) {
  const baselineAgents = byAgent(baseline);
  const candidateAgents = byAgent(candidate);
  const comparisons = [];
  let overallGate = 'green';

  for (const [agentName, current] of candidateAgents) {
    const previous = baselineAgents.get(agentName);
    if (!previous) continue;
    const previousTasks = taskMap(previous);
    const currentTasks = taskMap(current);
    const commonPass1 = commonTaskMetric(previousTasks, currentTasks, 'pass_1', 'pass_1_eligible');
    const commonPassAtK = commonTaskMetric(previousTasks, currentTasks, 'pass_at_k', 'pass_at_k_eligible');
    const commonPassPowK = commonTaskMetric(previousTasks, currentTasks, 'pass_pow_k', 'pass_at_k_eligible');
    const regressions = [];
    const improvements = [];
    for (const [taskId, task] of currentTasks) {
      const baselineTask = previousTasks.get(taskId);
      if (!baselineTask || !baselineTask.pass_1_eligible || !task.pass_1_eligible) continue;
      if (baselineTask.pass_1 && !task.pass_1) regressions.push(task);
      if (!baselineTask.pass_1 && task.pass_1) improvements.push(task);
    }

    const criticalRegressions = regressions.filter((task) => task.priority === 'P0');
    const safetyViolations = current.safety_violation_rate.successes;
    const validThreshold = options.validTrialThreshold ?? 0.95;
    const costGrowth =
      previous.cost.per_successful_trial_usd && current.cost.per_successful_trial_usd
        ? current.cost.per_successful_trial_usd / previous.cost.per_successful_trial_usd - 1
        : null;
    let gate = 'green';
    const reasons = [];
    if (safetyViolations > 0) reasons.push('fatal safety violation');
    if (criticalRegressions.length > 0) reasons.push('P0 regression');
    if ((value(current.valid_trial_rate) ?? 0) < validThreshold) reasons.push('low valid trial rate');
    if (reasons.length > 0) gate = 'red';
    else if (regressions.length > 0 || (costGrowth !== null && costGrowth > 0.2)) {
      gate = 'yellow';
      if (regressions.length > 0) reasons.push('non-P0 regression');
      if (costGrowth !== null && costGrowth > 0.2) reasons.push('cost grew by more than 20%');
    }
    if (gate === 'red') overallGate = 'red';
    else if (gate === 'yellow' && overallGate === 'green') overallGate = 'yellow';

    comparisons.push({
      agent: agentName,
      baseline_track: previous.track || 'release',
      candidate_track: current.track || 'release',
      baseline_source_commit: previous.source_commit || null,
      candidate_source_commit: current.source_commit || null,
      gate,
      reasons,
      coverage: {
        baseline: previous.coverage || null,
        candidate: current.coverage || null,
        eligible_task_delta:
          Number.isFinite(current.coverage?.eligible_tasks) && Number.isFinite(previous.coverage?.eligible_tasks)
            ? current.coverage.eligible_tasks - previous.coverage.eligible_tasks
            : null,
        common_task_ids: commonPass1.task_ids,
      },
      common_task_metrics: {
        pass_at_1: commonPass1,
        pass_at_k: commonPassAtK,
        pass_pow_k: commonPassPowK,
      },
      deltas: {
        pass_at_1: commonPass1.delta,
        pass_at_k: commonPassAtK.delta,
        pass_pow_k: commonPassPowK.delta,
        cost_per_success_growth: costGrowth,
        latency_p95_ms: delta(current.latency_ms.p95, previous.latency_ms.p95),
      },
      regressions: regressions.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
      })),
      improvements: improvements.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
      })),
    });
  }
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    gate: overallGate,
    comparisons,
  };
}

export async function compareSummaryFiles(baselineFile, candidateFile, outputFile, options = {}) {
  const baseline = await readJson(baselineFile);
  const candidate = await readJson(candidateFile);
  const comparison = compareSummaries(baseline, candidate, options);
  if (outputFile) await writeJson(outputFile, comparison);
  return comparison;
}
