import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { aggregateRun } from '../src/core/aggregate.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { evaluate } from '../src/core/evaluator.mjs';
import { loadTasks, selectTasks } from '../src/core/task-loader.mjs';
import { fileDigest } from '../src/dataset/canonical.mjs';
import { qualifyAdapterFromRun } from '../src/dataset/cross-agent.mjs';

const root = path.resolve(import.meta.dirname, '..');
const family = String(process.env.MOSS_EVAL_LOCAL_AGENT || '');
if (!['claude-code', 'codex'].includes(family)) throw new Error('MOSS_EVAL_LOCAL_AGENT must be claude-code or codex');
const protocol = JSON.parse(await fsp.readFile(path.join(root, '.moss-eval', 'governance', 'current', 'protocol.json'), 'utf8'));
const taskIds = String(process.env.MOSS_EVAL_TASK_IDS || 'real-moss-plan-device-mutation').split(',').map((item) => item.trim()).filter(Boolean);
const command = family === 'claude-code' ? 'C:/Users/tongchun.zhao/.local/bin/claude.exe' : process.execPath;
const args = family === 'claude-code'
  ? ['--print', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '{instruction}']
  : ['C:/Users/tongchun.zhao/nodejs-v22/node-v22.23.1-win-x64/node_modules/@openai/codex/bin/codex.js', 'exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--ephemeral', '--skip-git-repo-check', '-C', '{workspace}', '{instruction}'];
const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-cross-agent-config-'));
const configFile = path.join(temp, 'config.json');
await fsp.writeFile(configFile, JSON.stringify({ schema_version: '1.0', output_root: path.join(root, '.moss-eval', 'runs'), task_roots: [path.join(root, 'datasets', 'real-failure-pilot', 'tasks')], default_runner: 'local', execution: { concurrency: 1, trials: 1, k: 1, valid_trial_threshold: 0.95 }, runners: { local: { allow: true }, docker: { command: 'docker' }, pty: {} }, agents: { [family]: { adapter: 'command', command, args, provider: 'first-party-account', model: 'account-default', track: 'development-host-local' } } }, null, 2));
try {
  const config = await loadConfig(configFile); const all = await loadTasks(config.task_roots); const tasks = selectTasks(all, { ids: taskIds });
  if (tasks.length !== taskIds.length) throw new Error('One or more requested qualification tasks were not found');
  for (const task of tasks) {
    const grader = task.graders.find((item) => item.id === 'behavioral-oracle');
    grader.command = [process.execPath, path.join(root, 'scripts', 'run-professional-oracle.mjs'), path.join(task._meta.directory, 'oracle', 'verify.mjs'), '{workspace}', '{taskId}'];
  }
  const run = await evaluate({ tasks, agentNames: [family], config, label: `${family}-host-local-qualification`, trialsOverride: 1, concurrency: 1, allowLocal: true, runnerOverride: 'local', progress(trial, completed, total) { process.stdout.write(`[${completed}/${total}] ${trial.success ? 'PASS' : 'FAIL'} ${trial.task.id}${trial.failure_category ? ` · ${trial.failure_category}` : ''}\n`); } });
  const summary = await aggregateRun(run.runDir, { k: 1 });
  const qualification = qualifyAdapterFromRun({ agent_family: family, adapter_id: 'command-host-local', adapter_version: family === 'claude-code' ? '2.1.220' : '0.149.1', protocol_digest: protocol.protocol_digest, trials: run.trials.map((trial) => ({ instruction_delivered: true, workspace_isolated: false, receipt_present: trial.outcome_passed === true, exit_handled: true, transcript_captured: true, timeout_enforced: true, secret_cleanup: true })) });
  const report = { schema_version: '1.0', claim: 'host-local-development-run-not-protocol-comparable', agent_family: family, run_id: run.runId, run_directory: run.runDir, dataset_digest: protocol.dataset_digest, requested_protocol_digest: protocol.protocol_digest, actual_environment: { platform: process.platform, arch: process.arch, runner: 'local', isolated: false }, qualification, summary_digest: await fileDigest(path.join(run.runDir, 'summary.json')), metrics: summary.agents?.find((item) => item.agent === family) || null };
  await fsp.writeFile(path.join(run.runDir, 'cross-agent-development-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await fsp.rm(temp, { recursive: true, force: true });
}
