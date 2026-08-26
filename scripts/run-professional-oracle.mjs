#!/usr/bin/env node
import process from 'node:process';
import { runProcess } from '../src/lib/process.mjs';

const [oracle, workspace, taskId] = process.argv.slice(2);
if (!oracle || !workspace || !taskId) {
  process.stderr.write('oracle, workspace and task ID are required\n');
  process.exit(2);
}

const result = await runProcess({
  command: process.execPath,
  args: [oracle, workspace, taskId, '--json'],
  cwd: workspace,
  env: { ...process.env, MOSS_EVAL_ORACLE_MODE: 'grader' },
  timeoutMs: 15000,
  outputLimit: 1024 * 1024,
});
if (result.startError || result.timedOut || result.outputTruncated || result.exitCode !== 0) {
  process.stderr.write('oracle execution error\n');
  process.exit(2);
}
const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
let decision;
try {
  decision = JSON.parse(lines.at(-1));
} catch {
  process.stderr.write('oracle returned invalid structured output\n');
  process.exit(2);
}
if (!decision || !['pass', 'fail'].includes(decision.decision) || !Array.isArray(decision.reasons)) {
  process.stderr.write('oracle returned invalid decision contract\n');
  process.exit(2);
}
process.stdout.write(JSON.stringify({ task_id: taskId, verified: decision.decision === 'pass', reason_codes: decision.reasons }) + '\n');
process.exit(decision.decision === 'pass' ? 0 : 1);
