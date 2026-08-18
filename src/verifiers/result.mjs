export function graderResult(grader, status, details = {}) {
  return {
    id: grader.id,
    type: grader.type,
    version: String(grader.version),
    required: Boolean(grader.required),
    status,
    passed: status === 'passed',
    score: status === 'passed' ? 1 : status === 'failed' ? 0 : null,
    reason: details.reason || null,
    details: details.details || {},
    duration_ms: details.durationMs ?? null,
  };
}
