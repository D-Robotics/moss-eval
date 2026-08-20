import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { aggregateRun } from '../../src/core/aggregate.mjs';
import {
  achievedTelemetryLevel,
  evaluateTaskEligibility,
  telemetryAtLeast,
} from '../../src/core/capabilities.mjs';
import { compareSummaries } from '../../src/core/compare.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { evaluate } from '../../src/core/evaluator.mjs';
import { loadTasks, selectTasks } from '../../src/core/task-loader.mjs';

const root = path.resolve(import.meta.dirname, '../..');

function task(requirements = {}) {
  return {
    id: 'capability-task', mode: 'stream-json', environment: { runner: 'docker' },
    capability_requirements: {
      schema_version: '1.0', modes: ['stream-json'], min_telemetry_level: 'L2',
      required_tools: ['read_file'], required_any_tools: ['edit_file', 'apply_patch'],
      required_tags: ['coding-repository'], runners: ['docker'], sandbox_features: ['network-control'],
      ...requirements,
    },
  };
}

test('capability matcher distinguishes eligible tasks from NOT_APPLICABLE with evidence', () => {
  const eligible = evaluateTaskEligibility(task(), {
    modes: ['stream-json'], telemetry_level: 'L3', tools: ['read_file', 'apply_patch'],
    tags: ['coding-repository'], runners: ['docker'], sandbox_features: ['network-control'],
  });
  assert.equal(eligible.status, 'eligible');
  assert.deepEqual(eligible.missing, []);

  const unavailable = evaluateTaskEligibility(task(), {
    modes: ['one-shot'], telemetry_level: 'L0', tools: [], tags: [], runners: ['docker'], sandbox_features: [],
  });
  assert.equal(unavailable.status, 'NOT_APPLICABLE');
  assert.ok(unavailable.missing.some((item) => item.type === 'mode'));
  assert.ok(unavailable.missing.some((item) => item.type === 'telemetry_level'));
  assert.ok(unavailable.missing.some((item) => item.type === 'required_tools'));
});

test('telemetry levels are monotonic and based on observed structured data', () => {
  assert.equal(telemetryAtLeast('L3', 'L1'), true);
  assert.equal(telemetryAtLeast('L0', 'L1'), false);
  assert.equal(achievedTelemetryLevel({ tool_calls: [], usage: {} }, 'one-shot'), 'L0');
  assert.equal(achievedTelemetryLevel({ tool_calls: [], usage: {} }, 'stream-json'), 'L1');
  assert.equal(achievedTelemetryLevel({ tool_calls: [], usage: { total_tokens: 10 } }, 'stream-json'), 'L2');
  assert.equal(achievedTelemetryLevel({
    tool_calls: [], usage: { total_tokens: 10 }, native_telemetry: { available: true },
  }, 'stream-json'), 'L3');
});

test('scheduler persists NOT_APPLICABLE decisions and excludes them from pass denominators', async (t) => {
  const outputRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-capability-run-'));
  t.after(() => fsp.rm(outputRoot, { recursive: true, force: true }));
  const config = await loadConfig(path.join(root, 'configs/mock.example.json'));
  config.output_root = outputRoot;
  config.agents.mock.command = process.execPath;
  const tasks = selectTasks(await loadTasks(config.task_roots), {
    ids: ['smoke-create-file', 'smoke-safety'],
  });
  tasks[0].capability_requirements.required_tags = ['unsupported-special-tag'];
  const result = await evaluate({
    tasks, agentNames: ['mock'], config, allowLocal: true, trialsOverride: 1,
    targetCapabilitiesByAgent: {
      mock: {
        modes: ['stream-json'], telemetry_level: 'L1', tools: [], tags: [],
        runners: ['local'], sandbox_features: [],
      },
    },
  });
  assert.equal(result.trials.length, 1);
  assert.equal(result.metadata.not_applicable_task_agent_count, 1);
  const summary = await aggregateRun(result.runDir, { k: 1 });
  assert.equal(summary.agents[0].coverage.total_tasks, 2);
  assert.equal(summary.agents[0].coverage.eligible_tasks, 1);
  assert.equal(summary.agents[0].coverage.not_applicable_tasks, 1);
  assert.equal(summary.agents[0].pass_at_1.total, 1);
  assert.equal(summary.agents[0].tasks.find((item) => item.id === tasks[0].id).applicability, 'NOT_APPLICABLE');
});

test('comparison computes pass deltas only on the common eligible task intersection', () => {
  const agent = (tasks, eligibleTasks) => ({
    agent: 'agent', track: 'release', source_commit: null,
    valid_trial_rate: { value: 1 }, safety_violation_rate: { successes: 0 },
    cost: { per_successful_trial_usd: null }, latency_ms: { p95: 100 },
    pass_at_1: { value: 1 }, pass_at_k: { value: null }, pass_pow_k: { value: null },
    coverage: { total_tasks: 2, eligible_tasks: eligibleTasks, not_applicable_tasks: 2 - eligibleTasks },
    tasks,
  });
  const baseline = agent([
    { id: 'common', title: 'common', priority: 'P1', applicability: 'eligible', pass_1_eligible: true, pass_1: true },
    { id: 'baseline-only', applicability: 'eligible', pass_1_eligible: true, pass_1: true },
  ], 2);
  const candidate = agent([
    { id: 'common', title: 'common', priority: 'P1', applicability: 'eligible', pass_1_eligible: true, pass_1: false },
    { id: 'baseline-only', applicability: 'NOT_APPLICABLE', pass_1_eligible: false, pass_1: null },
  ], 1);
  const comparison = compareSummaries({ agents: [baseline] }, { agents: [candidate] });
  const result = comparison.comparisons[0];
  assert.deepEqual(result.coverage.common_task_ids, ['common']);
  assert.equal(result.common_task_metrics.pass_at_1.common_task_count, 1);
  assert.equal(result.deltas.pass_at_1, -1);
  assert.equal(result.coverage.eligible_task_delta, -1);
});
