import fsp from 'node:fs/promises';
import path from 'node:path';

import { aggregateRun } from '../src/core/aggregate.mjs';
import { createAuthorizationRequest, grantAuthorization } from '../src/core/authorization.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { evaluate } from '../src/core/evaluator.mjs';
import { validateModelConfiguration } from '../src/core/model-configuration.mjs';
import { loadTasks, selectTasks } from '../src/core/task-loader.mjs';
import { auditProfessionalDataset } from '../src/dataset/audit.mjs';
import { calibrateProfessionalDataset } from '../src/dataset/calibration.mjs';
import { buildProfessionalRelease } from '../src/dataset/release.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const datasetRoot = path.join(projectRoot, 'datasets', 'professional-seed');
const sourceConfig = path.resolve(String(process.env.MOSS_EVAL_SOURCE_CONFIG || ''));
const apiKey = String(process.env.MOSS_EVAL_REAL_API_KEY || '');
if (!process.env.MOSS_EVAL_SOURCE_CONFIG) throw new Error('MOSS_EVAL_SOURCE_CONFIG is required');
if (!apiKey) throw new Error('MOSS_EVAL_REAL_API_KEY is required');
delete process.env.MOSS_EVAL_REAL_API_KEY;

const audited = await auditProfessionalDataset(datasetRoot);
if (audited.report.technical_gate !== 'pass') throw new Error('Professional dataset technical gate did not pass');
const calibrated = await calibrateProfessionalDataset(datasetRoot);
if (calibrated.report.gate !== 'pass') throw new Error('Professional dataset calibration gate did not pass');
const release = await buildProfessionalRelease(datasetRoot, { calibration: calibrated.report });
if (release.result.release_eligible) throw new Error('Public development dataset unexpectedly became release eligible');

const config = await loadConfig(sourceConfig);
config.task_roots = [path.join(datasetRoot, 'tasks')];
config.output_root = path.join(projectRoot, '.moss-eval', 'runs');
config.execution.concurrency = 1;
config.execution.trials = 1;
config.execution.k = 1;
const authorizationRequest = createAuthorizationRequest({
  operation: 'professional-development-canary',
  network: { mode: 'public', purpose: 'Call the explicitly configured model endpoint from the isolated MOSS trial' },
});
config.execution.environment_overrides = {
  ...(config.execution.environment_overrides || {}),
  network: 'public',
  authorization: grantAuthorization(authorizationRequest, { confirmed: true, approveNetwork: true }),
};
const modelConfiguration = validateModelConfiguration({
  protocol: process.env.MOSS_EVAL_MODEL_PROTOCOL || 'auto',
  model: process.env.MOSS_EVAL_MODEL,
  base_url: process.env.MOSS_EVAL_MODEL_BASE_URL,
  api_key: apiKey,
});
const agent = config.agents.moss;
agent.provider = modelConfiguration.provider;
agent.model = modelConfiguration.model;
agent.isolated_workspace_actions_authorized = true;
Object.defineProperty(agent, '_model_configuration', { value: modelConfiguration, enumerable: false });
Object.defineProperty(agent, '_moss_auto_approve', { value: true, enumerable: false });

const allTasks = await loadTasks(config.task_roots);
const requested = String(process.env.MOSS_EVAL_TASK_IDS || 'pro-code-001').split(',').map((value) => value.trim()).filter(Boolean);
const tasks = selectTasks(allTasks, { suite: 'professional-canary', ids: requested });
if (!tasks.length) throw new Error('No professional Canary task was selected');

const run = await evaluate({
  tasks,
  agentNames: ['moss'],
  config,
  label: 'moss-professional-development-canary',
  trialsOverride: 1,
  concurrency: 1,
  allowLocal: false,
  progress(trial, completed, total) {
    process.stdout.write(`[${completed}/${total}] ${trial.success ? 'PASS' : 'FAIL'} ${trial.task.id}${trial.failure_category ? ` · ${trial.failure_category}` : ''}\n`);
  },
});
const summary = await aggregateRun(run.runDir, { k: 1 });

async function filesBelow(directory) {
  const files = [];
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(item));
    else if (entry.isFile()) files.push(item);
  }
  return files;
}

const trialFiles = (await filesBelow(run.runDir)).filter((file) => path.basename(file) === 'trial.json');
const compliance = [];
for (const trialFile of trialFiles) {
  const trial = JSON.parse(await fsp.readFile(trialFile, 'utf8'));
  const agentMounts = trial.process?.mount_policy?.mounts || [];
  const commandGrader = trial.graders?.find((grader) => grader.type === 'command');
  const graderMounts = commandGrader?.details?.mount_policy?.mounts || [];
  const trialDirectory = path.dirname(trialFile);
  const secretFile = path.join(trialDirectory, '.secrets', 'moss-model.json');
  const secretFileRemoved = await fsp.access(secretFile).then(() => false, () => true);
  let secretLeak = false;
  for (const file of await filesBelow(trialDirectory)) {
    const content = await fsp.readFile(file);
    if (content.includes(Buffer.from(apiKey))) {
      secretLeak = true;
      break;
    }
  }
  compliance.push({
    task_id: trial.task.id,
    outcome: trial.success ? 'pass' : 'fail',
    failure_category: trial.failure_category,
    receipt_present: await fsp.access(path.join(trialDirectory, 'workspace', 'results', `${trial.task.id}.json`)).then(() => true, () => false),
    telemetry_level: trial.metrics?.telemetry_level || null,
    telemetry_valid: trial.metrics?.telemetry_valid ?? null,
    agent_oracle_isolation: trial.process?.mount_policy?.phase === 'agent'
      && agentMounts.every((mount) => !['task', 'evaluator', 'oracle'].includes(mount.role)),
    grader_oracle_isolation: commandGrader?.details?.mount_policy?.phase === 'grader'
      && graderMounts.some((mount) => mount.role === 'evaluator' && mount.read_only === true),
    transient_secret_removed: secretFileRemoved,
    artifact_secret_scan_passed: !secretLeak,
  });
}
if (compliance.some((item) => !item.agent_oracle_isolation || !item.grader_oracle_isolation || !item.transient_secret_removed || !item.artifact_secret_scan_passed)) {
  throw new Error('Canary compliance evidence failed closed');
}

const aggregate = summary.agents?.find((item) => item.agent === 'moss') || {};
process.stdout.write(`${JSON.stringify({
  claim: 'development-canary-only',
  run_id: run.runId,
  run_directory: run.runDir,
  source_repository: agent.source_repository,
  source_commit: agent.source_commit,
  configured_image: config.execution.environment_overrides.image,
  dataset_digest: calibrated.report.dataset_digest,
  professional_release_status: release.result.status,
  professional_release_blockers: release.result.blockers,
  trial_count: summary.trial_count,
  passed_trials: aggregate.trial_success_rate?.successes ?? 0,
  compliance,
}, null, 2)}\n`);
