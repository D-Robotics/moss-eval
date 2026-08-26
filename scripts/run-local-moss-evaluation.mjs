import path from 'node:path';

import { EvaluationService } from '../src/core/evaluation-service.mjs';
import { ensureStoragePaths, resolveStoragePaths } from '../src/core/storage-paths.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const userDataRoot = path.resolve(
  process.env.MOSS_EVAL_USER_DATA_ROOT
    || path.join(process.env.APPDATA || '', 'moss-eval-client'),
);
const apiKey = String(process.env.MOSS_EVAL_REAL_API_KEY || '');
if (!apiKey) throw new Error('MOSS_EVAL_REAL_API_KEY is required');
delete process.env.MOSS_EVAL_REAL_API_KEY;

const targetFingerprint = String(process.env.MOSS_EVAL_TARGET_FINGERPRINT || '');
if (!/^[a-f0-9]{64}$/i.test(targetFingerprint)) throw new Error('MOSS_EVAL_TARGET_FINGERPRINT must be a 64-character fingerprint');
const taskIds = String(process.env.MOSS_EVAL_TASK_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
const trials = Number(process.env.MOSS_EVAL_TRIALS || 1);
const concurrency = Number(process.env.MOSS_EVAL_CONCURRENCY || 1);
const paths = await ensureStoragePaths(resolveStoragePaths({ userDataRoot, projectRoot }));

let resolveFinished;
let rejectFinished;
const finished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
const service = new EvaluationService({
  paths,
  dockerCommand: process.env.MOSS_EVAL_DOCKER_COMMAND || 'docker',
  eventSink(event) {
    if (event.type === 'trial_started') {
      process.stdout.write(`[start] ${event.data.task_id} #${event.data.replicate}\n`);
    } else if (event.type === 'trial_completed') {
      const trial = event.data.trial;
      process.stdout.write(`[${event.data.completed}/${event.data.total}] ${trial.success ? 'PASS' : 'FAIL'} ${trial.task.id} #${trial.replicate}${trial.failure_category ? ` · ${trial.failure_category}` : ''}\n`);
    } else if (event.type === 'run_completed') {
      resolveFinished(event.data);
    } else if (event.type === 'run_failed') {
      rejectFinished(Object.assign(new Error(event.data.error || 'Evaluation failed'), { code: event.data.code }));
    }
  },
});

const started = await service.start({
  config_id: 'moss.example.json',
  target_fingerprint: targetFingerprint,
  approve_runtime_network: true,
  approve_agent_workspace_actions: true,
  model_configuration: {
    protocol: process.env.MOSS_EVAL_MODEL_PROTOCOL || 'auto',
    model: process.env.MOSS_EVAL_MODEL || 'deepseek-v4-flash',
    base_url: process.env.MOSS_EVAL_MODEL_BASE_URL || 'https://ai-api.d-robotics.cc/v1',
    api_key: apiKey,
  },
  suite: process.env.MOSS_EVAL_SUITE || 'release',
  task_ids: taskIds.length ? taskIds : null,
  trials,
  concurrency,
  k: trials,
  label: process.env.MOSS_EVAL_LABEL || 'real-moss',
});
process.stdout.write(`[run] ${started.run_id}\n[artifacts] ${started.run_directory}\n`);
const completed = await finished;
const agent = completed.summary?.agents?.[0] || {};
process.stdout.write(`${JSON.stringify({
  run_id: completed.run_id,
  trial_count: completed.summary?.trial_count,
  task_count: agent.coverage?.total_tasks,
  passed_trials: agent.trial_success_rate?.successes,
  pass_at_1: agent.pass_at_1?.value,
  safety_violations: agent.safety_violation_rate?.successes,
  failure_categories: agent.failure_categories,
  known_cost_usd: agent.cost?.known_total_usd ?? agent.cost?.total_usd,
  tokens: agent.tokens?.known_total ?? agent.tokens?.total,
}, null, 2)}\n`);
