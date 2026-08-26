import assert from 'node:assert/strict';
import test from 'node:test';

import { explainRunSummary } from '../../src/cli/result-report.mjs';

test('plain terminal report explains one-shot limits and release blockers', () => {
  const metric = { successes: 2, total: 3, value: 2 / 3 };
  const report = explainRunSummary({ trial_count: 3, agents: [{ agent: 'moss', k: 1, tasks: [{}, {}, {}], trial_success_rate: metric, outcome_pass_rate: metric, valid_trial_rate: { successes: 3, total: 3, value: 1 }, safety_violation_rate: { successes: 0, total: 3, value: 0 }, latency_ms: { p50: 1000, p95: 2000 }, cost: { total_usd: 0.1 }, tokens: { total: 10 }, tools: { trusted_trial_count: 3, total_calls: 5, execution_failure_rate: 0 } }] }, { eligible: false, blockers: ['hidden_oracle-gate-not-passed'] });
  assert.ok(report.lines.some((line) => line.includes('不能说明重复运行稳定性')));
  assert.ok(report.lines.some((line) => line.includes('真实私有隐藏验收集')));
});
