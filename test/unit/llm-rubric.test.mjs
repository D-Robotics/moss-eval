import test from 'node:test';
import assert from 'node:assert/strict';
import { runLlmRubricVerifier } from '../../src/verifiers/llm-rubric.mjs';

test('LLM verifier sends and persists the structured rubric without object coercion', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: '{"verdict":"pass","score":0.75,"reason":"clear"}' } }] };
      },
    };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const rubric = {
    version: 'quality-v1',
    criteria: [{ id: 'clarity', description: 'Response is clear', weight: 1 }],
    score_scale: { min: 0, max: 1 },
  };
  const result = await runLlmRubricVerifier({
    id: 'quality', type: 'llm_rubric', version: '1', required: false,
    timeout_seconds: 5, rubric,
  }, {
    judge: { base_url: 'https://judge.invalid/v1', model: 'judge-model', provider: 'fixture', consent: true },
    task: { instruction: 'Answer clearly' },
    outcomeResults: [],
    traceSummary: { final_response: 'Done' },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.score, 0.75);
  assert.deepEqual(result.rubric, rubric);
  assert.equal(result.judge.rubric_version, 'quality-v1');
  assert.match(requestBody.messages[0].content, /"criteria"/);
  assert.doesNotMatch(requestBody.messages[0].content, /\[object Object\]/);
});
