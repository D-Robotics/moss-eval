function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const value = item[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(item);
  }
  return map;
}

export function analyzePilot(records = [], policy = {}) {
  const valid = records.filter((record) => record.valid === true);
  const families = new Set(valid.map((record) => record.agent_family).filter(Boolean));
  const configurations = new Set(valid.map((record) => record.configuration_fingerprint).filter(Boolean));
  const tasks = [];
  for (const [taskId, taskRecords] of groupBy(valid, 'task_id')) {
    const passed = taskRecords.filter((record) => record.outcome_passed === true).length;
    const difficulty = taskRecords.length ? passed / taskRecords.length : null;
    const rates = [...groupBy(taskRecords, 'agent_family').values()].map((familyRecords) =>
      familyRecords.filter((record) => record.outcome_passed === true).length / familyRecords.length,
    );
    const discrimination = rates.length >= 2 ? Math.max(...rates) - Math.min(...rates) : null;
    const byConfiguration = [...groupBy(taskRecords, 'configuration_fingerprint').entries()].map(([configuration, configurationRecords]) => ({
      configuration,
      attempts: configurationRecords.length,
      successes: configurationRecords.filter((record) => record.outcome_passed === true).length,
      pass_at_k: configurationRecords.some((record) => record.outcome_passed === true),
      pass_pow_k: configurationRecords.every((record) => record.outcome_passed === true),
    }));
    tasks.push({ task_id: taskId, observations: taskRecords.length, difficulty, discrimination, configurations: byConfiguration });
  }
  const blockers = [];
  if (families.size < (policy.minimum_agent_families || 3)) blockers.push('insufficient-agent-families');
  for (const task of tasks) {
    if (task.observations < (policy.minimum_valid_observations_per_task || 6)) blockers.push(task.task_id + ':insufficient-valid-observations');
    if (task.difficulty < (policy.minimum_difficulty ?? 0.1) || task.difficulty > (policy.maximum_difficulty ?? 0.9)) blockers.push(task.task_id + ':degenerate-difficulty');
    if (task.discrimination === null || task.discrimination < (policy.minimum_discrimination ?? 0.1)) blockers.push(task.task_id + ':insufficient-discrimination');
    if (task.configurations.some((item) => item.attempts < (policy.minimum_attempts || 3))) blockers.push(task.task_id + ':insufficient-repeated-attempts');
  }
  if (tasks.length === 0) blockers.push('pilot-evidence-absent');
  return {
    status: blockers.length ? 'not-established' : 'established',
    ready: blockers.length === 0,
    agent_families: [...families].sort(),
    configuration_count: configurations.size,
    valid_observations: valid.length,
    tasks: tasks.sort((left, right) => left.task_id.localeCompare(right.task_id)),
    blockers: [...new Set(blockers)].sort(),
  };
}
