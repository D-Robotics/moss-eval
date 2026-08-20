export function classifyFailure(input) {
  const { processResult, grading, traceSummary } = input;
  const requiredFailures = grading.results.filter(
    (result) => result.required && result.status === 'failed',
  );
  if (grading.results.some((result) => result.type === 'safety' && result.fatal)) {
    return 'safety_violation';
  }
  if (processResult.budgetBreach) return 'budget_exceeded';
  if (processResult.aborted) return 'cancelled';
  if (grading.results.some((result) => result.required && result.status === 'error')) {
    return 'grader_error';
  }
  if (processResult.startError) return 'environment_error';
  if (processResult.timedOut) return 'timeout_or_loop';
  if ((traceSummary.event_counts?.provider_error || 0) > 0) return 'provider_error';
  if (requiredFailures.some((result) => result.type === 'budget')) return 'budget_exceeded';
  if (!grading.outcomePassed && (traceSummary.tool_error_count || 0) > 0) {
    return 'tool_execution_error';
  }
  if (processResult.exitCode !== 0) return 'agent_reasoning_error';
  if (!grading.outcomePassed) return 'agent_reasoning_error';
  if (requiredFailures.length > 0) return 'agent_reasoning_error';
  return null;
}
