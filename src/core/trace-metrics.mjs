import { scoreToolExpectations } from './native-telemetry.mjs';

function repeatedCalls(toolCalls) {
  const counts = new Map();
  for (const call of toolCalls) {
    const key = call.tool + '|' + JSON.stringify(call.arguments || {});
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0);
}

function percentile(values, proportion) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(proportion * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function deriveTraceMetrics(summary, processResult, workspaceDiff, toolExpectations = null) {
  const calls = summary.tool_calls || [];
  const durations = calls.map((call) => call.duration_ms).filter(Number.isFinite);
  const callsByName = {};
  for (const call of calls) callsByName[call.tool] = (callsByName[call.tool] || 0) + 1;
  const componentTokens =
    (summary.usage?.input_tokens || 0) + (summary.usage?.output_tokens || 0);
  const totalTokens = summary.usage?.total_tokens ?? (componentTokens || null);
  return {
    tool_call_count: calls.length,
    tool_schema_error_count: calls.filter((call) => call.status === 'schema_error').length,
    tool_execution_failure_count: calls.filter((call) => call.status === 'error').length,
    duplicate_tool_call_count: repeatedCalls(calls),
    tool_calls_by_name: callsByName,
    tool_duration_ms: {
      records: durations.length,
      total: durations.reduce((sum, duration) => sum + duration, 0),
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    retry_count: summary.retries || 0,
    context_compaction_count: summary.context_compactions || 0,
    subagent_spawn_count: summary.subagent_spawns || 0,
    model_call_count: summary.model_call_count ?? summary.event_counts?.llm_usage ??
      summary.event_counts?.assistant_message ?? null,
    total_tokens: totalTokens,
    cost_usd: summary.cost_usd,
    duration_ms: processResult.durationMs,
    timed_out: processResult.timedOut,
    exit_code: processResult.exitCode,
    changed_files: workspaceDiff.changed.length,
    added_files: workspaceDiff.added.length,
    removed_files: workspaceDiff.removed.length,
    native_telemetry_available: Boolean(summary.native_telemetry?.available),
    telemetry_valid: summary.telemetry?.valid ?? null,
    telemetry_mismatch_count: summary.telemetry?.mismatches?.length || 0,
    tool_quality: scoreToolExpectations(calls, toolExpectations),
  };
}
