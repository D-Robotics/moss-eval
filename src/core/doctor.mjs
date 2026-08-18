import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { loadTasks } from './task-loader.mjs';
import { runProcess } from '../lib/process.mjs';

const execFileAsync = promisify(execFile);

async function findCommand(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const result = await execFileAsync(locator, [command], { timeout: 5000, windowsHide: true });
    return result.stdout.split(/\r?\n/).find(Boolean) || null;
  } catch {
    return null;
  }
}

async function ptyAvailable() {
  try {
    await import('node-pty');
    return true;
  } catch {
    return false;
  }
}

async function browserAvailable() {
  try {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    return { available: existsSync(executable), detail: executable };
  } catch {
    return { available: false, detail: 'playwright package or Chromium executable not installed' };
  }
}

export async function doctor(config) {
  const tasks = await loadTasks(config.task_roots);
  const runners = new Set(tasks.map((task) => task.environment.runner));
  const modes = new Set(tasks.map((task) => task.mode));
  const checks = [];
  let dockerRuntime = null;
  checks.push({
    id: 'node-version',
    status: Number(process.versions.node.split('.')[0]) >= 22 ? 'pass' : 'fail',
    detail: process.version,
  });
  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.adapter === 'mock') continue;
    const resolved = await findCommand(agent.command);
    checks.push({
      id: 'agent-' + name,
      status: resolved ? 'pass' : 'fail',
      detail: resolved || 'command not found: ' + agent.command,
    });
  }
  if (runners.has('docker')) {
    const dockerConfig = config.runners.docker;
    const command = dockerConfig.command || 'docker';
    const resolved = await findCommand(command);
    let detail = resolved || 'Docker CLI not found';
    let available = false;
    if (resolved) {
      const probe = await runProcess({
        command,
        args: [
          ...(dockerConfig.prefix_args || []),
          'version',
          '--format',
          '{{.Server.Version}}',
        ],
        cwd: config._meta.evaluationRoot,
        timeoutMs: 15000,
      });
      available = probe.exitCode === 0 && !probe.startError && !probe.timedOut;
      detail = available
        ? 'Docker server ' + probe.stdout.trim()
        : (probe.stderr || probe.stdout || 'Docker daemon unavailable').trim();
    }
    checks.push({
      id: 'docker',
      status: available ? 'pass' : 'fail',
      detail,
    });
    dockerRuntime = { command, prefixArgs: dockerConfig.prefix_args || [], available };
  }
  if (runners.has('pty')) {
    const available = await ptyAvailable();
    checks.push({
      id: 'pty',
      status: available ? 'pass' : 'fail',
      detail: available ? 'node-pty available' : 'optional node-pty package not installed',
    });
  }
  if (modes.has('browser')) {
    const browser = await browserAvailable();
    checks.push({
      id: 'browser',
      status: browser.available ? 'pass' : 'fail',
      detail: browser.available ? 'Playwright Chromium ' + browser.detail : browser.detail,
    });
  }
  if (modes.has('device')) {
    let available = false;
    let detail = 'Docker runtime unavailable';
    if (dockerRuntime?.available) {
      const probe = await runProcess({
        command: dockerRuntime.command,
        args: [...dockerRuntime.prefixArgs, 'image', 'inspect', 'moss-eval-device-sim:local', '--format', '{{.Id}}'],
        cwd: config._meta.evaluationRoot,
        timeoutMs: 15000,
      });
      available = probe.exitCode === 0 && !probe.startError && !probe.timedOut;
      detail = available
        ? 'SSH device simulator ' + probe.stdout.trim()
        : 'moss-eval-device-sim:local is not built; run npm run env:device:build';
    }
    checks.push({ id: 'device-simulator', status: available ? 'pass' : 'fail', detail });
  }
  const dockerTasks = tasks.filter((task) => task.environment.runner === 'docker');
  if (dockerTasks.length > 0) {
    const unpinned = dockerTasks.filter(
      (task) => !task.environment.image_digest && !task.environment.image?.includes('@sha256:'),
    );
    checks.push({
      id: 'image-pinning',
      status: unpinned.length === 0 ? 'pass' : 'warn',
      detail: unpinned.length === 0
        ? 'all Docker tasks use immutable image digests'
        : unpinned.length + ' Docker tasks use mutable image tags',
    });
  }
  const networkOverride = config.execution.environment_overrides?.network;
  if (networkOverride) {
    const changed = tasks.filter((task) => task.environment.network !== networkOverride).length;
    checks.push({
      id: 'environment-overrides',
      status: changed > 0 ? 'warn' : 'pass',
      detail: changed > 0
        ? 'runtime network override ' + networkOverride + ' changes ' + changed + ' task declarations; fingerprint records the override'
        : 'runtime environment override matches all task declarations',
    });
  }
  const candidates = tasks.filter(
    (task) => task.provenance?.quality_status === 'candidate-needs-domain-review',
  );
  if (candidates.length > 0) {
    checks.push({
      id: 'task-calibration',
      status: 'warn',
      detail: candidates.length + ' candidate tasks still require domain review',
    });
  }
  checks.push({
    id: 'tasks',
    status: tasks.length > 0 ? 'pass' : 'fail',
    detail: tasks.length + ' valid task definitions',
  });
  return {
    ready: checks.every((check) => check.status !== 'fail'),
    checks,
  };
}
