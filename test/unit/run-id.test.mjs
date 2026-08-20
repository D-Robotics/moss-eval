import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunId } from '../../src/core/run-id.mjs';

test('concurrent run IDs remain unique within the same clock instant', async () => {
  const now = new Date('2026-08-20T00:00:00.000Z');
  const identifiers = await Promise.all(
    Array.from({ length: 1000 }, async () => createRunId('same-label', { now })),
  );
  assert.equal(new Set(identifiers).size, identifiers.length);
  assert.ok(identifiers.every((identifier) => identifier.endsWith('-same-label')));
});
