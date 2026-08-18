import { graderResult } from './result.mjs';

function parseJudgeJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Judge did not return a JSON object');
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!['pass', 'fail', 'uncertain'].includes(parsed.verdict)) {
    throw new Error('Judge verdict must be pass, fail, or uncertain');
  }
  return parsed;
}

export async function runLlmRubricVerifier(grader, context) {
  const started = Date.now();
  const judge = context.judge;
  if (!judge?.base_url || !judge?.model) {
    return graderResult(grader, grader.required ? 'error' : 'skipped', {
      reason: 'LLM judge is not configured',
      durationMs: Date.now() - started,
    });
  }
  const endpoint =
    judge.base_url.replace(/\/$/, '') +
    (judge.base_url.endsWith('/chat/completions') ? '' : '/chat/completions');
  const prompt = [
    'You are an evaluation grader. Return JSON only.',
    'Allowed verdicts: pass, fail, uncertain.',
    'Rubric:',
    grader.rubric || '',
    'Task:',
    context.task.instruction,
    'Outcome grader results:',
    JSON.stringify(context.outcomeResults),
    'Final response:',
    context.traceSummary.final_response || '',
    'Return a JSON object with verdict, score, and reason.',
  ].join('\n\n');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: judge.api_key ? 'Bearer ' + judge.api_key : '',
      },
      body: JSON.stringify({
        model: judge.model,
        temperature: judge.temperature ?? 0,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(grader.timeout_seconds * 1000),
    });
    if (!response.ok) throw new Error('Judge HTTP ' + response.status);
    const payload = await response.json();
    const judged = parseJudgeJson(payload.choices?.[0]?.message?.content || '');
    const status =
      judged.verdict === 'pass' ? 'passed' : judged.verdict === 'fail' ? 'failed' : 'uncertain';
    const result = graderResult(grader, status, {
      reason: judged.reason,
      details: { verdict: judged.verdict },
      durationMs: Date.now() - started,
    });
    result.score = Number.isFinite(judged.score)
      ? Math.max(0, Math.min(1, judged.score))
      : result.score;
    return result;
  } catch (error) {
    return graderResult(grader, 'error', {
      reason: error.message,
      durationMs: Date.now() - started,
    });
  }
}
