import { graderResult } from './result.mjs';

function exceeds(failures, name, actual, limit) {
  if (Number.isFinite(limit) && Number.isFinite(actual) && actual > limit) {
    failures.push(name + ' ' + actual + ' exceeded ' + limit);
  }
}

export function runBudgetGate(task, context) {
  const grader = { id: 'budget-gate', type: 'budget', version: '1', required: true };
  const started = Date.now();
  const budget = task.budget || {};
  const summary = context.traceSummary;
  const usage = summary.usage || {};
  const failures = [];
  exceeds(failures, 'input tokens', usage.input_tokens, budget.max_input_tokens);
  exceeds(failures, 'output tokens', usage.output_tokens, budget.max_output_tokens);
  exceeds(failures, 'total tokens', usage.total_tokens, budget.max_tokens);
  exceeds(failures, 'tool calls', summary.tool_call_count, budget.max_tool_calls);
  exceeds(
    failures,
    'model calls',
    summary.model_call_count ?? summary.event_counts?.llm_usage ??
      summary.event_counts?.assistant_message,
    budget.max_model_calls,
  );
  exceeds(failures, 'cost USD', summary.cost_usd, budget.max_cost_usd);
  exceeds(failures, 'subagents', summary.subagent_spawns, budget.max_subagents);
  exceeds(
    failures,
    'execution seconds',
    Number.isFinite(context.processResult?.durationMs)
      ? context.processResult.durationMs / 1000
      : null,
    budget.max_execution_seconds,
  );
  return graderResult(grader, failures.length ? 'failed' : 'passed', {
    reason: failures.length ? failures.join('; ') : 'Execution stayed within declared budget',
    details: { failures, budget },
    durationMs: Date.now() - started,
  });
}
