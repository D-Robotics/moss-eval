import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTrials, wilsonInterval } from '../../src/core/aggregate.mjs';

function trial(id, replicate, success) {
  return {
    task: { id, title: id, category: 'coding', priority: 'P1', mode: 'stream-json' },
    agent: 'moss', replicate, valid: true, success, outcome_passed: success,
    safety_passed: true, faults: [], failure_category: success ? null : 'agent_reasoning_error',
    metrics: { cost_usd: 0.1, duration_ms: 100 },
  };
}

test('aggregate separates pass@k from pass^k', () => {
  const summary = aggregateTrials([
    trial('a', 1, false), trial('a', 2, true), trial('a', 3, false),
    trial('b', 1, true), trial('b', 2, true), trial('b', 3, true),
  ], { k: 3 });
  assert.equal(summary.agents[0].pass_at_k.value, 1);
  assert.equal(summary.agents[0].pass_pow_k.value, 0.5);
  assert.equal(summary.agents[0].pass_at_1.value, 0.5);
});

test('Wilson interval handles empty and bounded samples', () => {
  assert.deepEqual(wilsonInterval(0, 0), { low: null, high: null });
  const interval = wilsonInterval(5, 10);
  assert.ok(interval.low >= 0 && interval.high <= 1);
});

test('aggregate preserves source provenance', () => {
  const sourceTrial = trial('source-task', 1, true);
  sourceTrial.fingerprint = {
    track: 'source',
    source: { commit: 'a'.repeat(40) },
    image_digest: 'sha256:source-image',
  };

  const summary = aggregateTrials([sourceTrial], { k: 1 });
  assert.equal(summary.agents[0].track, 'source');
  assert.equal(summary.agents[0].source_commit, 'a'.repeat(40));
  assert.deepEqual(summary.agents[0].image_digests, ['sha256:source-image']);
});

test('aggregate excludes telemetry mismatches from trusted tool quality', () => {
  const trusted = trial('trusted', 1, true);
  trusted.metrics = {
    ...trusted.metrics,
    native_telemetry_available: true,
    telemetry_valid: true,
    telemetry_mismatch_count: 0,
    tool_call_count: 2,
    tool_execution_failure_count: 0,
    tool_duration_ms: { records: 2, total: 20 },
    tool_quality: { eligible: true, precision: 1, recall: 1, f1: 1, policy_passed: true },
  };
  const mismatched = trial('mismatch', 1, true);
  mismatched.metrics = {
    ...mismatched.metrics,
    native_telemetry_available: true,
    telemetry_valid: false,
    telemetry_mismatch_count: 1,
    tool_call_count: 99,
    tool_execution_failure_count: 99,
    tool_duration_ms: { records: 99, total: 9900 },
    tool_quality: { eligible: true, precision: 0, recall: 0, f1: 0, policy_passed: false },
  };
  const summary = aggregateTrials([trusted, mismatched], { k: 1 }).agents[0];
  assert.equal(summary.telemetry.valid_rate.value, 0.5);
  assert.equal(summary.telemetry.mismatch_count, 1);
  assert.equal(summary.tools.trusted_trial_count, 1);
  assert.equal(summary.tools.total_calls, 2);
  assert.equal(summary.tools.quality.macro_f1, 1);
});

test('aggregate preserves unknown cost, token, and latency coverage instead of coercing zero', () => {
  const known = trial('known', 1, true);
  known.metrics = { ...known.metrics, total_tokens: 10 };
  const unknown = trial('unknown', 1, true);
  unknown.metrics = { cost_usd: null, duration_ms: null, total_tokens: null };

  const summary = aggregateTrials([known, unknown], { k: 1 }).agents[0];
  assert.equal(summary.cost.total_usd, null);
  assert.equal(summary.cost.known_total_usd, 0.1);
  assert.equal(summary.cost.coverage.value, 0.5);
  assert.equal(summary.cost.unknown_trial_count, 1);
  assert.equal(summary.cost.per_successful_trial_usd, null);
  assert.equal(summary.tokens.total, null);
  assert.equal(summary.tokens.known_total, 10);
  assert.equal(summary.tokens.coverage.value, 0.5);
  assert.equal(summary.latency_ms.coverage.value, 0.5);
});
