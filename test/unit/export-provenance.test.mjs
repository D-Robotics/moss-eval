import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { buildAgentEvalExport } from '../../src/integrations/agent-eval-service.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('exports are visibly incomplete when governed provenance is unavailable', async () => {
  const exported = await buildAgentEvalExport(path.join(root, 'test/fixtures/artifacts/run-v1'));
  assert.equal(exported.provenance_complete, false);
  assert.equal(exported.claim_status, 'incomplete-provenance');
  assert.ok(exported.provenance_missing.includes('dataset_digest'));
  assert.equal(exported.release_decision.status, 'development-only');
});
