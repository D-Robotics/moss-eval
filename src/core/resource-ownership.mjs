import { runProcess } from '../lib/process.mjs';

export const OWNER_LABEL = 'com.drobotics.moss-eval.owner';

async function checkedProcess(spec, processRunner) {
  const result = await processRunner(spec);
  if (result.startError || result.timedOut || result.exitCode !== 0) {
    throw new Error(result.startError?.message || result.stderr || result.stdout || 'Container reconciliation failed');
  }
  return result;
}

export async function reconcileOwnedContainers(options = {}) {
  const processRunner = options.processRunner || runProcess;
  const command = options.command || 'docker';
  const prefixArgs = options.prefixArgs || [];
  const owner = options.owner;
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(owner || '')) throw new Error('A safe evaluator owner id is required');
  const listed = await checkedProcess({
    command,
    args: [...prefixArgs, 'ps', '-aq', '--filter', `label=${OWNER_LABEL}=${owner}`],
    timeoutMs: 15_000,
  }, processRunner);
  const containers = listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (options.dryRun !== false || containers.length === 0) return { owner, containers, removed: [] };
  await checkedProcess({
    command,
    args: [...prefixArgs, 'rm', '-f', ...containers],
    timeoutMs: 30_000,
  }, processRunner);
  return { owner, containers, removed: containers };
}
