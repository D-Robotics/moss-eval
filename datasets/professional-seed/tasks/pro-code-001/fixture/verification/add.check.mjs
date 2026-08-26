import assert from 'node:assert/strict';
import test from 'node:test';
import { add } from '../src/add.mjs';

test('adds finite numbers numerically', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-1.5, 2), 0.5);
});

test('preserves invalid-input validation', () => {
  assert.throws(() => add('2', 3), TypeError);
  assert.throws(() => add(Number.POSITIVE_INFINITY, 3), TypeError);
});
