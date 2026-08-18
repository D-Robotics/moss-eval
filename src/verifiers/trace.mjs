import { graderResult } from './result.mjs';

export async function runTraceVerifier(grader, context) {
  const started = Date.now();
  const assertions = grader.assertions || {};
  const summary = context.traceSummary;
  const failures = [];
  const calls = summary.tool_calls || [];
  const tools = new Set(calls.map((call) => call.tool));
  const eventTypes = new Set(Object.keys(summary.event_counts || {}));

  if (Number.isFinite(assertions.max_tool_calls) && calls.length > assertions.max_tool_calls) {
    failures.push('tool calls exceeded ' + assertions.max_tool_calls);
  }
  if (Number.isFinite(assertions.max_retries) && summary.retries > assertions.max_retries) {
    failures.push('retries exceeded ' + assertions.max_retries);
  }
  for (const tool of assertions.require_tools || []) if (!tools.has(tool)) failures.push('missing tool ' + tool);
  for (const tool of assertions.forbid_tools || []) if (tools.has(tool)) failures.push('forbidden tool ' + tool);
  for (const type of assertions.require_event_types || []) {
    if (!eventTypes.has(type)) failures.push('missing event ' + type);
  }
  for (const type of assertions.forbid_event_types || []) {
    if (eventTypes.has(type)) failures.push('forbidden event ' + type);
  }
  if (assertions.final_response_matches) {
    const expression = new RegExp(assertions.final_response_matches, assertions.flags || 'mi');
    if (!expression.test(summary.final_response || '')) failures.push('final response did not match');
  }
  if (assertions.final_response_not_matches) {
    const expression = new RegExp(assertions.final_response_not_matches, assertions.flags || 'mi');
    if (expression.test(summary.final_response || '')) failures.push('final response matched forbidden text');
  }

  return graderResult(grader, failures.length ? 'failed' : 'passed', {
    reason: failures.length ? failures.join('; ') : 'Trace assertions passed',
    details: { failures },
    durationMs: Date.now() - started,
  });
}
