const MODES = new Set(['one-shot', 'stream-json', 'pty', 'acp', 'embedded', 'browser', 'device']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const RUNNERS = new Set(['local', 'docker', 'pty']);
const GRADERS = new Set(['command', 'file', 'trace', 'llm_rubric']);
const OUTCOME_GRADERS = new Set(['command', 'file']);

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function requireField(task, field, errors) {
  if (!present(task[field])) errors.push('missing ' + field);
}

function validateToolExpectations(expectations, errors) {
  if (expectations === undefined || expectations === null) return;
  if (typeof expectations !== 'object' || Array.isArray(expectations)) {
    errors.push('tool_expectations must be an object');
    return;
  }
  for (const key of [
    'expected',
    'required_any',
    'required_all',
    'forbidden',
    'mutation_tools',
    'verification_tools',
  ]) {
    if (expectations[key] === undefined) continue;
    if (
      !Array.isArray(expectations[key]) ||
      expectations[key].some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      errors.push('tool_expectations.' + key + ' must be an array of non-empty strings');
    }
  }
  if (
    expectations.max_calls !== undefined &&
    (!Number.isInteger(expectations.max_calls) || expectations.max_calls < 0)
  ) {
    errors.push('tool_expectations.max_calls must be a non-negative integer');
  }
  if (
    expectations.must_verify_after_mutation !== undefined &&
    typeof expectations.must_verify_after_mutation !== 'boolean'
  ) {
    errors.push('tool_expectations.must_verify_after_mutation must be boolean');
  }
}

export class TaskValidationError extends Error {
  constructor(file, errors) {
    super('Invalid task in ' + file + ':\n- ' + errors.join('\n- '));
    this.name = 'TaskValidationError';
    this.file = file;
    this.errors = errors;
  }
}

export function validateTask(task, file = '<memory>') {
  const errors = [];
  for (const field of [
    'id',
    'version',
    'title',
    'category',
    'priority',
    'mode',
    'instruction',
    'owner',
    'environment',
    'budget',
    'trials',
    'graders',
    'fatal_assertions',
    'artifacts',
    'reference_solution',
  ]) {
    requireField(task, field, errors);
  }

  if (present(task.id) && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(task.id)) {
    errors.push('id must contain 2-120 safe characters');
  }
  if (present(task.priority) && !PRIORITIES.has(task.priority)) {
    errors.push('priority must be P0, P1, or P2');
  }
  if (present(task.mode) && !MODES.has(task.mode)) {
    errors.push('unsupported mode ' + task.mode);
  }
  if (!Number.isInteger(task.trials) || task.trials < 1) {
    errors.push('trials must be a positive integer');
  }

  if (!task.budget || typeof task.budget !== 'object') {
    errors.push('budget must be an object');
  } else {
    for (const [key, value] of Object.entries(task.budget)) {
      if (!Number.isFinite(value) || value < 0) errors.push('budget.' + key + ' must be non-negative');
    }
  }

  if (task.environment && typeof task.environment === 'object') {
    if (!present(task.environment.runner)) errors.push('environment.runner is required');
    else if (!RUNNERS.has(task.environment.runner)) {
      errors.push('unsupported environment.runner ' + task.environment.runner);
    }
    if (!Number.isFinite(task.environment.timeout_seconds) || task.environment.timeout_seconds <= 0) {
      errors.push('environment.timeout_seconds must be positive');
    }
    if (task.environment.runner === 'docker' && !present(task.environment.image)) {
      errors.push('Docker tasks require environment.image');
    }
    const network = task.environment.network || 'disabled';
    if (!['disabled', 'public', 'allowlist'].includes(network)) {
      errors.push('environment.network must be disabled, public, or allowlist');
    }
    if (network === 'allowlist' && !Array.isArray(task.environment.allowed_hosts)) {
      errors.push('allowlist network requires environment.allowed_hosts');
    }
  }

  if (!Array.isArray(task.graders) || task.graders.length === 0) {
    errors.push('graders must be a non-empty array');
  } else {
    const identifiers = new Set();
    let requiredOutcome = false;
    for (const [index, grader] of task.graders.entries()) {
      if (!grader || typeof grader !== 'object') {
        errors.push('grader ' + index + ' must be an object');
        continue;
      }
      if (!present(grader.id)) errors.push('grader ' + index + ' is missing id');
      else if (identifiers.has(grader.id)) errors.push('duplicate grader id ' + grader.id);
      else identifiers.add(grader.id);
      if (!GRADERS.has(grader.type)) errors.push('grader ' + index + ' has unsupported type');
      if (typeof grader.required !== 'boolean') errors.push('grader ' + index + ' requires boolean required');
      if (!present(grader.version)) errors.push('grader ' + index + ' is missing version');
      if (!Number.isFinite(grader.timeout_seconds) || grader.timeout_seconds <= 0) {
        errors.push('grader ' + index + ' timeout_seconds must be positive');
      }
      if (grader.required && OUTCOME_GRADERS.has(grader.type)) requiredOutcome = true;
    }
    if (!requiredOutcome) errors.push('at least one required command or file outcome grader is required');
  }

  if (!Array.isArray(task.fatal_assertions)) errors.push('fatal_assertions must be an array');
  if (!Array.isArray(task.artifacts)) errors.push('artifacts must be an array');
  validateToolExpectations(task.tool_expectations, errors);
  if (task.priority === 'P0' && /safety|permission|security/i.test(task.category) && task.fatal_assertions?.length === 0) {
    errors.push('P0 safety tasks require fatal_assertions');
  }

  if (errors.length > 0) throw new TaskValidationError(file, errors);
  return task;
}
