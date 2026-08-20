import { scoreToolExpectations } from './native-telemetry.mjs';
import { achievedTelemetryLevel, telemetryAtLeast } from './capabilities.mjs';

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

export function deriveTraceMetrics(summary, processResult, workspaceDiff, toolExpectations = null, mode = null) {
  const calls = summary.tool_calls || [];
  const telemetryLevel = achievedTelemetryLevel(summary, mode);
  const toolTelemetryAvailable = telemetryAtLeast(telemetryLevel, 'L1');
  const modelTelemetryAvailable = telemetryAtLeast(telemetryLevel, 'L2');
  const lifecycleTelemetryAvailable = telemetryAtLeast(telemetryLevel, 'L3');
  const durations = calls.map((call) => call.duration_ms).filter(Number.isFinite);
  const callsByName = {};
  for (const call of calls) callsByName[call.tool] = (callsByName[call.tool] || 0) + 1;
  const componentTokens =
    (summary.usage?.input_tokens || 0) + (summary.usage?.output_tokens || 0);
  const totalTokens = summary.usage?.total_tokens ?? (componentTokens || null);
  return {
    telemetry_level: telemetryLevel,
    metric_availability: {
      outcome: { available: true, required_level: 'L0' },
      tools: { available: toolTelemetryAvailable, required_level: 'L1' },
      model_usage: { available: modelTelemetryAvailable, required_level: 'L2' },
      lifecycle: { available: lifecycleTelemetryAvailable, required_level: 'L3' },
    },
    tool_call_count: toolTelemetryAvailable ? calls.length : null,
    tool_schema_error_count: toolTelemetryAvailable ? calls.filter((call) => call.status === 'schema_error').length : null,
    tool_execution_failure_count: toolTelemetryAvailable ? calls.filter((call) => call.status === 'error').length : null,
    duplicate_tool_call_count: toolTelemetryAvailable ? repeatedCalls(calls) : null,
    tool_calls_by_name: toolTelemetryAvailable ? callsByName : null,
    tool_duration_ms: toolTelemetryAvailable ? {
      records: durations.length,
      total: durations.reduce((sum, duration) => sum + duration, 0),
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    } : null,
    retry_count: lifecycleTelemetryAvailable ? summary.retries || 0 : null,
    context_compaction_count: lifecycleTelemetryAvailable ? summary.context_compactions || 0 : null,
    subagent_spawn_count: lifecycleTelemetryAvailable ? summary.subagent_spawns || 0 : null,
    model_call_count: modelTelemetryAvailable
      ? summary.model_call_count ?? summary.event_counts?.llm_usage ?? summary.event_counts?.assistant_message ?? null
      : null,
    total_tokens: modelTelemetryAvailable && Number.isFinite(totalTokens) ? totalTokens : null,
    cost_usd: modelTelemetryAvailable && Number.isFinite(summary.cost_usd) ? summary.cost_usd : null,
    duration_ms: Number.isFinite(processResult.durationMs) ? processResult.durationMs : null,
    timed_out: processResult.timedOut,
    exit_code: processResult.exitCode,
    changed_files: workspaceDiff.changed.length,
    added_files: workspaceDiff.added.length,
    removed_files: workspaceDiff.removed.length,
    native_telemetry_available: Boolean(summary.native_telemetry?.available),
    telemetry_valid: summary.telemetry?.valid ?? null,
    telemetry_mismatch_count: summary.telemetry?.mismatches?.length || 0,
    tool_quality: toolTelemetryAvailable
      ? scoreToolExpectations(calls, toolExpectations)
      : { eligible: false, reason: 'requires L1 structured tool telemetry' },
  };
}
