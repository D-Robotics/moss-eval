import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { loadTasks } from './task-loader.mjs';
import { runProcess } from '../lib/process.mjs';
import { findDockerCli } from './desktop-runtime.mjs';

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

function processCheck(id, result, passDetail, failureDetail, remediation) {
  const passed = result && result.exitCode === 0 && !result.startError && !result.timedOut;
  return {
    id,
    status: passed ? 'pass' : 'fail',
    detail: passed
      ? (typeof passDetail === 'function' ? passDetail(result) : passDetail)
      : (typeof failureDetail === 'function' ? failureDetail(result) : failureDetail),
    remediation: passed ? null : remediation,
  };
}

function parseWslVersion(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`.replaceAll('\0', '');
  const match = output.match(/WSL[^0-9]*(\d+)\.(\d+)\.(\d+)/i);
  return match ? match.slice(1, 4).map(Number) : null;
}

function supportedWslVersion(version) {
  if (!version) return false;
  const [major, minor, patch] = version;
  return major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 5)));
}

export async function desktopDoctor(options = {}) {
  const platform = options.platform || process.platform;
  const architecture = options.architecture || process.arch;
  const processRunner = options.processRunner || runProcess;
  const diskRoot = options.diskRoot || process.cwd();
  const checks = [];
  checks.push({
    id: 'windows-version',
    status: platform === 'win32' ? 'pass' : 'fail',
    detail: platform === 'win32' ? `Windows ${options.osRelease || os.release()}` : `Unsupported platform: ${platform}`,
    remediation: platform === 'win32' ? null : 'Use the Windows MVP on a supported Windows 10/11 host.',
  });
  checks.push({
    id: 'architecture',
    status: ['x64', 'arm64'].includes(architecture) ? 'pass' : 'fail',
    detail: architecture,
    remediation: ['x64', 'arm64'].includes(architecture) ? null : 'Install a supported x64 or arm64 build.',
  });
  try {
    const disk = await fsp.statfs(diskRoot);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    const minimumBytes = options.minimumDiskBytes || 10 * 1024 * 1024 * 1024;
    checks.push({
      id: 'disk-space',
      status: availableBytes >= minimumBytes ? 'pass' : 'fail',
      detail: `${availableBytes} bytes available`,
      remediation: availableBytes >= minimumBytes ? null : `Free at least ${minimumBytes} bytes for snapshots, images, and runs.`,
    });
  } catch (error) {
    checks.push({ id: 'disk-space', status: 'fail', detail: error.message, remediation: 'Choose a readable user-data location and retry.' });
  }

  let wslResult = null;
  let virtualizationResult = null;
  let dockerResult = null;
  if (platform === 'win32') {
    wslResult = await processRunner({ command: 'wsl.exe', args: ['--version'], timeoutMs: 15_000 });
    const wslVersion = parseWslVersion(wslResult);
    const wslHealthy = wslResult.exitCode === 0 && !wslResult.startError && !wslResult.timedOut && supportedWslVersion(wslVersion);
    const wslCheck = {
      id: 'wsl2',
      status: wslHealthy ? 'pass' : 'fail',
      detail: wslHealthy
        ? `WSL ${wslVersion.join('.')} meets the required 2.1.5 minimum`
        : (wslResult.startError?.message || (wslVersion ? `WSL ${wslVersion.join('.')} is below the required 2.1.5 minimum` : 'WSL version is unavailable or too old')).trim(),
      remediation: wslHealthy ? null : 'Install or enable WSL2, ensure virtualization is enabled, then run `wsl --update`.',
    };
    checks.push(wslCheck);
    if (wslCheck.status === 'fail') Object.assign(wslCheck, { action: 'install-wsl', action_label: '查看 WSL2 安装步骤' });
    virtualizationResult = await processRunner({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystem).HypervisorPresent'],
      timeoutMs: 15_000,
    });
    const virtualizationHealthy = virtualizationResult.exitCode === 0
      && !virtualizationResult.startError
      && /^true$/i.test(String(virtualizationResult.stdout || '').trim());
    checks.push({
      id: 'virtualization',
      status: virtualizationHealthy ? 'pass' : 'fail',
      detail: virtualizationHealthy
        ? 'Windows hypervisor and hardware virtualization path are active'
        : (virtualizationResult.startError?.message || virtualizationResult.stderr || virtualizationResult.stdout || 'Windows hypervisor is not active').trim(),
      remediation: virtualizationHealthy ? null : 'Enable CPU virtualization in BIOS/UEFI and the Virtual Machine Platform Windows feature, then restart Windows.',
      action: virtualizationHealthy ? null : 'virtualization-help',
      action_label: virtualizationHealthy ? null : '查看虚拟化启用步骤',
    });
  } else {
    checks.push({ id: 'wsl2', status: 'fail', detail: 'WSL2 check requires Windows', remediation: 'Use a supported Windows host.', action: null, action_label: null });
    checks.push({ id: 'virtualization', status: 'fail', detail: 'Virtualization check requires Windows', remediation: 'Use a supported Windows host.', action: null, action_label: null });
  }

  let dockerCommand = options.dockerCommand || 'docker';
  dockerResult = await processRunner({
    command: dockerCommand,
    args: ['version', '--format', '{{.Server.Version}}'],
    timeoutMs: 15_000,
  });
  if (dockerResult?.startError?.code === 'ENOENT' && platform === 'win32' && !options.dockerCommand) {
    const discovered = findDockerCli({ environment: options.environment, fileExists: options.fileExists });
    if (discovered) {
      dockerCommand = discovered;
      dockerResult = await processRunner({
        command: dockerCommand,
        args: ['version', '--format', '{{.Server.Version}}'],
        timeoutMs: 15_000,
      });
    }
  }
  const dockerInstalled = dockerResult?.startError?.code !== 'ENOENT';
  const dockerReady = dockerInstalled && dockerResult.exitCode === 0 && !dockerResult.startError && !dockerResult.timedOut;
  checks.push({
    id: 'docker-installation',
    status: dockerInstalled ? 'pass' : 'fail',
    detail: dockerInstalled ? `Docker CLI ${dockerCommand}` : 'Docker CLI is not installed',
    remediation: dockerInstalled ? null : 'Install Docker Desktop using the official Windows installer and keep the WSL2 backend enabled.',
    action: dockerInstalled ? null : 'install-docker',
    action_label: dockerInstalled ? null : '下载并安装 Docker Desktop',
  });
  checks.push(processCheck(
    'docker-runtime',
    dockerResult,
    (result) => `Docker server ${(result.stdout || '').trim()}`,
    (result) => !dockerInstalled
      ? 'Docker daemon check is blocked until Docker Desktop is installed'
      : (result?.startError?.message || result?.stderr || result?.stdout || 'Docker daemon is unreachable').trim(),
    !dockerInstalled
      ? 'Install Docker Desktop before checking its daemon.'
      : 'Start Docker Desktop, wait for its engine to become ready, then retry.',
  ));
  const dockerRuntimeCheck = checks.at(-1);
  Object.assign(dockerRuntimeCheck, {
    action: dockerInstalled && !dockerReady ? 'start-docker' : null,
    action_label: dockerInstalled && !dockerReady ? '启动 Docker Desktop' : null,
  });

  const blocking = new Set(['windows-version', 'architecture', 'disk-space', 'wsl2', 'virtualization', 'docker-installation', 'docker-runtime']);
  return {
    schema_version: '1.0',
    checked_at: new Date().toISOString(),
    ready: checks.every((check) => !blocking.has(check.id) || check.status === 'pass'),
    source_inspection_available: true,
    evaluation_available: checks.every((check) => !blocking.has(check.id) || check.status === 'pass'),
    runtime: {
      docker_command: dockerInstalled ? dockerCommand : null,
      docker_installed: dockerInstalled,
      docker_daemon_ready: dockerReady,
    },
    checks,
  };
}
