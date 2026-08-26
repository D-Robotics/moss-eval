import path from 'node:path';
import fsp from 'node:fs/promises';
import { runProcess } from '../lib/process.mjs';
import { withExecutableDirectory } from '../lib/process-environment.mjs';
import { sanitizeId } from '../lib/paths.mjs';
import {
  createSandboxPolicy,
  dockerPolicyArgs,
  validateEvaluatorMounts,
} from '../core/sandbox-policy.mjs';
import { OWNER_LABEL } from '../core/resource-ownership.mjs';

const IMAGE_CACHE = new Map();

function volumePath(value, style) {
  const resolved = path.resolve(value);
  if (style === 'wsl' && /^[A-Za-z]:[\\/]/.test(resolved)) {
    const drive = resolved[0].toLowerCase();
    const rest = resolved.slice(3).split(path.sep).join('/');
    return '/mnt/' + drive + '/' + rest;
  }
  return resolved;
}

export function dockerMountPlan(context) {
  const evaluatorOnly = context.task.oracle_isolation === 'evaluator-only';
  const graderPhase = context.phase === 'grader';
  const mounts = [
    { role: 'workspace', source: path.resolve(context.workspace), target: '/workspace', readOnly: false },
    { role: 'trial', source: path.resolve(context.trialDir), target: '/run', readOnly: false },
  ];
  if (!evaluatorOnly || graderPhase) {
    mounts.push(
      { role: 'task', source: path.resolve(context.taskDir), target: '/task', readOnly: true },
      { role: 'evaluator', source: path.resolve(context.evalRoot), target: '/eval', readOnly: true },
    );
  }
  if (graderPhase && context.oracleRoot) {
    mounts.push({ role: 'oracle', source: path.resolve(context.oracleRoot), target: '/oracle', readOnly: true });
  }
  return validateEvaluatorMounts(mounts);
}

function safeSecretPath(trialDirectory, relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || /[\0\r\n]/.test(normalized)) throw new Error('Secret file path is invalid');
  const root = path.resolve(trialDirectory);
  const target = path.resolve(root, ...normalized.split('/'));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Secret file path escaped the trial directory');
  return { target, containerPath: `/run/${normalized}` };
}

async function materializeSecretFiles(command, trialDirectory) {
  const created = [];
  try {
    for (const item of command.secret_files || []) {
      const resolved = safeSecretPath(trialDirectory, item.path);
      await fsp.mkdir(path.dirname(resolved.target), { recursive: true });
      await fsp.writeFile(resolved.target, String(item.content), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      created.push(resolved.target);
    }
    return created;
  } catch (error) {
    await Promise.all(created.map((file) => fsp.rm(file, { force: true })));
    throw error;
  }
}

async function removeSecretFiles(files, trialDirectory) {
  await Promise.all(files.map((file) => fsp.rm(file, { force: true })));
  const secretRoot = path.resolve(trialDirectory, '.secrets');
  if (secretRoot.startsWith(path.resolve(trialDirectory) + path.sep)) await fsp.rm(secretRoot, { recursive: true, force: true });
}

export class DockerRunner {
  constructor(configuration = {}) {
    this.configuration = configuration;
    this.command = configuration.command || 'docker';
    this.processEnvironment = withExecutableDirectory(this.command, configuration.environment || process.env);
    this.prefixArgs = configuration.prefix_args || [];
    this.pathStyle = configuration.path_style || 'native';
    this.processRunner = configuration.process_runner || runProcess;
    this.name = 'docker';
  }

  async resolveImage(image, cwd) {
    const key = [this.command, ...this.prefixArgs, image].join('\0');
    if (IMAGE_CACHE.has(key)) return IMAGE_CACHE.get(key);
    const inspected = await this.processRunner({
      command: this.command,
      args: [...this.prefixArgs, 'image', 'inspect', image, '--format', '{{.Id}}'],
      cwd,
      env: this.processEnvironment,
      timeoutMs: 15000,
    });
    const digest = inspected.exitCode === 0 ? inspected.stdout.trim() || null : null;
    if (digest) IMAGE_CACHE.set(key, digest);
    return digest;
  }

  paths() {
    return {
      workspace: '/workspace',
      task: '/task',
      run: '/run',
      trial: '/run',
      eval: '/eval',
    };
  }

  async run(command, context) {
    const environment = context.task.environment;
    if (environment.network === 'allowlist') {
      throw new Error('Docker allowlist networking requires an external policy backend and is not silently downgraded.');
    }
    const policy = createSandboxPolicy({
      network: environment.network,
      allowed_hosts: environment.allowed_hosts || [],
      cpu: environment.cpu,
      memory_mb: environment.memory_mb,
      pids: environment.pids,
      disk_mb: environment.disk_mb,
      timeout_seconds: context.timeoutMs / 1000,
      read_only_root: environment.read_only_root,
    }, environment.authorization || null);
    const name = sanitizeId('moss-eval-' + context.task.id + '-' + context.replicate + '-' + Date.now());
    const configuredImage = environment.image_digest || environment.image;
    let imageDigest = await this.resolveImage(configuredImage, context.trialDir);
    const mounts = dockerMountPlan(context);
    const owner = sanitizeId(path.basename(context.runDir));
    const args = [
      ...this.prefixArgs,
      'run',
      '--rm',
      '--name',
      name,
      '--workdir', '/workspace',
      ...dockerPolicyArgs(policy, {
        [OWNER_LABEL]: owner,
        'com.drobotics.moss-eval.trial': `${context.task.id}-${context.replicate}`,
      }),
    ];
    for (const mount of mounts) {
      args.push(
        '--volume',
        `${volumePath(mount.source, this.pathStyle)}:${mount.target}${mount.readOnly ? ':ro' : ''}`,
      );
    }
    const childEnvironment = { ...this.processEnvironment };
    const secretNames = new Set(command.metadata?.secret_env_names || []);
    for (const [key, value] of Object.entries(command.env || {})) {
      if (secretNames.has(key)) {
        childEnvironment[key] = String(value);
        args.push('--env', key);
      } else {
        args.push('--env', key + '=' + value);
      }
    }
    args.push(imageDigest || configuredImage, command.command, ...command.args);
    const secretFiles = await materializeSecretFiles(command, context.trialDir);
    let result;
    try {
      result = await this.processRunner({
        command: this.command,
        args,
        cwd: context.trialDir,
        env: childEnvironment,
        input: command.input,
        timeoutMs: context.timeoutMs,
        signal: context.signal,
        onStdout: context.onStdout,
        onStderr: context.onStderr,
      });
    } finally {
      await removeSecretFiles(secretFiles, context.trialDir);
    }
    if (!imageDigest) imageDigest = await this.resolveImage(configuredImage, context.trialDir);
    result.imageDigest = imageDigest;
    result.configuredImage = configuredImage;
    result.sandboxPolicy = policy;
    result.mountPolicy = {
      phase: context.phase || 'agent',
      oracle_isolation: context.task.oracle_isolation || 'legacy-shared',
      mounts: mounts.map((mount) => ({ role: mount.role, target: mount.target, read_only: mount.readOnly })),
    };
    if (result.timedOut) {
      result.budgetBreach = {
        type: 'wall_time',
        limit_seconds: policy.resources.timeout_seconds,
      };
    }
    return result;
  }
}
