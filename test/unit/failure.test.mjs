import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyFailure } from '../../src/core/failure.mjs';

function processResult(overrides = {}) {
  return {
    startError: null,
    timedOut: false,
    exitCode: 0,
    ...overrides,
  };
}

function grading(results, outcomePassed = true) {
  return { results, outcomePassed };
}

test('budget failure wins over a recovered intermediate tool error', () => {
  const category = classifyFailure({
    processResult: processResult(),
    grading: grading([
      { type: 'command', required: true, status: 'passed' },
      { type: 'budget', required: true, status: 'failed' },
    ]),
    traceSummary: { event_counts: {}, tool_error_count: 1 },
  });

  assert.equal(category, 'budget_exceeded');
});

test('recovered intermediate tool error does not fail a successful trial', () => {
  const category = classifyFailure({
    processResult: processResult(),
    grading: grading([{ type: 'command', required: true, status: 'passed' }]),
    traceSummary: { event_counts: {}, tool_error_count: 1 },
  });

  assert.equal(category, null);
});

test('tool error is primary when the outcome also fails', () => {
  const category = classifyFailure({
    processResult: processResult(),
    grading: grading([{ type: 'command', required: true, status: 'failed' }], false),
    traceSummary: { event_counts: {}, tool_error_count: 1 },
  });

  assert.equal(category, 'tool_execution_error');
});
