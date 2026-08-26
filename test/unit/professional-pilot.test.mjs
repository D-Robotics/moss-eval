import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePilot } from '../../src/dataset/pilot.mjs';

const policy = {
  minimum_agent_families: 3,
  minimum_valid_observations_per_task: 9,
  minimum_attempts: 3,
  minimum_difficulty: 0.1,
  maximum_difficulty: 0.9,
  minimum_discrimination: 0.1,
};

test('one-Agent pilot remains not established', () => {
  const result = analyzePilot([{ task_id: 'task', agent_family: 'moss', configuration_fingerprint: 'moss-a', valid: true, outcome_passed: true }], policy);
  assert.equal(result.status, 'not-established');
  assert.ok(result.blockers.includes('insufficient-agent-families'));
});

test('pilot reports difficulty discrimination and repeated reliability readiness', () => {
  const records = [];
  const outcomes = { alpha: [true, true, true], beta: [true, false, true], gamma: [false, false, false] };
  for (const [family, values] of Object.entries(outcomes)) {
    values.forEach((outcome, index) => records.push({
      task_id: 'task', agent_family: family, configuration_fingerprint: family + '-config', replicate: index + 1,
      valid: true, outcome_passed: outcome,
    }));
  }
  const result = analyzePilot(records, policy);
  assert.equal(result.ready, true);
  assert.equal(result.tasks[0].difficulty, 5 / 9);
  assert.equal(result.tasks[0].discrimination, 1);
});
