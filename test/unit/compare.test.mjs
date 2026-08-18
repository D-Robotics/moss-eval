import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSummaries } from '../../src/core/compare.mjs';

function agent(pass, safety = 0, track = 'release', sourceCommit = null) {
  return {
    agent: 'moss', track, source_commit: sourceCommit,
    pass_at_1: { value: pass ? 1 : 0 }, pass_at_k: { value: null }, pass_pow_k: { value: null },
    valid_trial_rate: { value: 1 }, safety_violation_rate: { successes: safety },
    cost: { per_successful_trial_usd: 1 }, latency_ms: { p95: 100 },
    tasks: [{ id: 'p0', title: 'critical', priority: 'P0', pass_1_eligible: true, pass_1: pass }],
  };
}

test('P0 regression produces a red release gate', () => {
  const commit = 'b'.repeat(40);
  const comparison = compareSummaries(
    { agents: [agent(true)] },
    { agents: [agent(false, 0, 'source', commit)] },
  );
  assert.equal(comparison.gate, 'red');
  assert.deepEqual(comparison.comparisons[0].deltas.pass_at_k, null);
  assert.equal(comparison.comparisons[0].baseline_track, 'release');
  assert.equal(comparison.comparisons[0].candidate_track, 'source');
  assert.equal(comparison.comparisons[0].candidate_source_commit, commit);
});
