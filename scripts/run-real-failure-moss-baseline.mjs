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
import { auditFailureCorpus } from '../src/dataset/failure-audit.mjs';
import { evaluateReleaseEvidence } from '../src/dataset/governance.mjs';
import { qualifyAdapterFromRun } from '../src/dataset/cross-agent.mjs';
import { fileDigest } from '../src/dataset/canonical.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const datasetRoot = path.join(projectRoot, 'datasets', 'real-failure-pilot');
const sourceConfig = path.resolve(String(process.env.MOSS_EVAL_SOURCE_CONFIG || ''));
const apiKey = String(process.env.MOSS_EVAL_REAL_API_KEY || '');
const trials = Number(process.env.MOSS_EVAL_TRIALS || 3);
const concurrency = Number(process.env.MOSS_EVAL_CONCURRENCY || 2);
if (!process.env.MOSS_EVAL_SOURCE_CONFIG) throw new Error('MOSS_EVAL_SOURCE_CONFIG is required');
if (!apiKey) throw new Error('MOSS_EVAL_REAL_API_KEY is required');
if (!Number.isInteger(trials) || trials < 1 || trials > 10) throw new Error('MOSS_EVAL_TRIALS must be an integer from 1 through 10');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('MOSS_EVAL_CONCURRENCY must be an integer from 1 through 4');
delete process.env.MOSS_EVAL_REAL_API_KEY;

const audited = await auditProfessionalDataset(datasetRoot);
if (audited.report.technical_gate !== 'pass') throw new Error('Real-failure dataset technical gate did not pass');
const calibrated = await calibrateProfessionalDataset(datasetRoot);
if (calibrated.report.gate !== 'pass') throw new Error('Real-failure dataset calibration gate did not pass');
const release = await buildProfessionalRelease(datasetRoot, { calibration: calibrated.report });
if (release.result.release_eligible) throw new Error('Public development dataset unexpectedly became release eligible');

const config = await loadConfig(sourceConfig);
config.task_roots = [path.join(datasetRoot, 'tasks')];
config.output_root = path.join(projectRoot, '.moss-eval', 'runs');
config.execution.concurrency = concurrency;
config.execution.trials = trials;
config.execution.k = trials;
const authorizationRequest = createAuthorizationRequest({
  operation: 'real-failure-development-baseline',
  network: { mode: 'public', purpose: 'Call the explicitly configured model endpoint from isolated MOSS trials' },
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
const requested = String(process.env.MOSS_EVAL_TASK_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
const tasks = selectTasks(allTasks, { suite: 'real-failure-canary', ids: requested.length ? requested : null });
if (tasks.length !== (requested.length || allTasks.length)) throw new Error(`Expected ${requested.length || allTasks.length} real-failure tasks, selected ${tasks.length}`);

const run = await evaluate({
  tasks,
  agentNames: ['moss'],
  config,
  label: 'moss-real-failure-baseline',
  trialsOverride: trials,
  concurrency,
  allowLocal: false,
  progress(trial, completed, total) {
    process.stdout.write(`[${completed}/${total}] ${trial.success ? 'PASS' : 'FAIL'} ${trial.task.id}${trial.failure_category ? ` · ${trial.failure_category}` : ''}\n`);
  },
});
const summary = await aggregateRun(run.runDir, { k: trials });

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
  const trialIndex = Number(path.basename(path.dirname(trialFile)).replace(/^trial-/, ''));
  const agentMounts = trial.process?.mount_policy?.mounts || [];
  const commandGrader = trial.graders?.find((grader) => grader.type === 'command');
  const graderMounts = commandGrader?.details?.mount_policy?.mounts || [];
  const trialDirectory = path.dirname(trialFile);
  const secretFile = path.join(trialDirectory, '.secrets', 'moss-model.json');
  const secretFileRemoved = await fsp.access(secretFile).then(() => false, () => true);
  let secretLeak = false;
  for (const file of await filesBelow(trialDirectory)) {
    const content = await fsp.readFile(file);
    if (content.includes(Buffer.from(apiKey))) { secretLeak = true; break; }
  }
  compliance.push({
    task_id: trial.task.id,
    trial_index: trialIndex,
    outcome: trial.success ? 'pass' : 'fail',
    failure_category: trial.failure_category,
    receipt_present: await fsp.access(path.join(trialDirectory, 'workspace', 'results', `${trial.task.id}.json`)).then(() => true, () => false),
    telemetry_level: trial.metrics?.telemetry_level || null,
    telemetry_valid: trial.metrics?.telemetry_valid ?? null,
    agent_oracle_isolation: trial.process?.mount_policy?.phase === 'agent' && agentMounts.every((mount) => !['task', 'evaluator', 'oracle'].includes(mount.role)),
    grader_oracle_isolation: commandGrader?.details?.mount_policy?.phase === 'grader' && graderMounts.some((mount) => mount.role === 'evaluator' && mount.read_only === true),
    transient_secret_removed: secretFileRemoved,
    artifact_secret_scan_passed: !secretLeak,
  });
}
if (compliance.some((item) => !item.agent_oracle_isolation || !item.grader_oracle_isolation || !item.transient_secret_removed || !item.artifact_secret_scan_passed)) throw new Error('Baseline compliance evidence failed closed');

const aggregate = summary.agents?.find((item) => item.agent === 'moss') || {};
const protocol = JSON.parse(await fsp.readFile(path.join(projectRoot, '.moss-eval', 'governance', 'current', 'protocol.json'), 'utf8'));
if (protocol.dataset_digest !== calibrated.report.dataset_digest) throw new Error('Frozen protocol does not match the current dataset; run npm run failure:governance');
const qualification = qualifyAdapterFromRun({ agent_family: 'moss', adapter_id: 'moss-source', adapter_version: agent.source_commit || 'unknown', protocol_digest: protocol.protocol_digest, trials: compliance.map((item) => ({ instruction_delivered: true, workspace_isolated: item.agent_oracle_isolation, receipt_present: item.receipt_present, exit_handled: true, transcript_captured: true, timeout_enforced: true, secret_cleanup: item.transient_secret_removed && item.artifact_secret_scan_passed })) });
const corpus = (await auditFailureCorpus(path.join(projectRoot, 'datasets', 'real-failures'))).report;
const releaseDecision = evaluateReleaseEvidence({ corpus, calibration: calibrated.report, source_reproduction: { verified: corpus.counts.reproduced, total: corpus.counts.accepted }, adapters: [qualification], cross_agent: null, hidden_oracle: null, signoffs: null, telemetry: { valid: compliance.every((item) => item.telemetry_valid === true) }, security: { secret_scan_passed: compliance.every((item) => item.artifact_secret_scan_passed), oracle_isolation_passed: compliance.every((item) => item.agent_oracle_isolation && item.grader_oracle_isolation) }, regression: null, packaged_client: null });
const report = {
  schema_version: '1.0',
  claim: 'real-failure-development-baseline-only',
  run_id: run.runId,
  run_directory: run.runDir,
  source_repository: agent.source_repository,
  source_commit: agent.source_commit,
  configured_image: config.execution.environment_overrides.image,
  model: modelConfiguration.model,
  endpoint_origin: new URL(modelConfiguration.baseUrl).origin,
  dataset_digest: calibrated.report.dataset_digest,
  protocol_digest: protocol.protocol_digest,
  adapter_qualification: qualification,
  environment_identity: protocol.environment,
  professional_release_status: release.result.status,
  professional_release_blockers: release.result.blockers,
  task_count: tasks.length,
  trials_per_task: trials,
  trial_count: summary.trial_count,
  valid_trial_rate: aggregate.valid_trial_rate,
  outcome_pass_rate: aggregate.outcome_pass_rate,
  trial_success_rate: aggregate.trial_success_rate,
  pass_at_1: aggregate.pass_at_1,
  pass_at_k: aggregate.pass_at_k,
  pass_pow_k: aggregate.pass_pow_k,
  safety_violation_rate: aggregate.safety_violation_rate,
  cost: aggregate.cost,
  tokens: aggregate.tokens,
  latency_ms: aggregate.latency_ms,
  telemetry: aggregate.telemetry,
  tools: aggregate.tools,
  failure_categories: aggregate.failure_categories,
  tasks: aggregate.tasks,
  compliance,
  release_decision: releaseDecision,
};
await fsp.writeFile(path.join(run.runDir, 'real-failure-baseline.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await fsp.writeFile(path.join(run.runDir, 'release-decision.json'), JSON.stringify({ ...releaseDecision, dataset_digest: calibrated.report.dataset_digest, protocol_digest: protocol.protocol_digest, source_commit: agent.source_commit, adapter_id: 'moss-source', run_id: run.runId, run_summary_digest: await fileDigest(path.join(run.runDir, 'summary.json')) }, null, 2) + '\n', 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
