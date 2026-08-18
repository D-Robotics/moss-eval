import path from 'node:path';
import { runProcess } from '../lib/process.mjs';
import { sanitizeId } from '../lib/paths.mjs';

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

export class DockerRunner {
  constructor(configuration = {}) {
    this.configuration = configuration;
    this.command = configuration.command || 'docker';
    this.prefixArgs = configuration.prefix_args || [];
    this.pathStyle = configuration.path_style || 'native';
    this.name = 'docker';
  }

  async resolveImage(image, cwd) {
    const key = [this.command, ...this.prefixArgs, image].join('\0');
    if (IMAGE_CACHE.has(key)) return IMAGE_CACHE.get(key);
    const inspected = await runProcess({
      command: this.command,
      args: [...this.prefixArgs, 'image', 'inspect', image, '--format', '{{.Id}}'],
      cwd,
      env: process.env,
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
    const name = sanitizeId('moss-eval-' + context.task.id + '-' + context.replicate + '-' + Date.now());
    const configuredImage = environment.image;
    let imageDigest = await this.resolveImage(configuredImage, context.trialDir);
    const args = [
      ...this.prefixArgs,
      'run',
      '--rm',
      '--name',
      name,
      '--workdir',
      '/workspace',
      '--volume',
      volumePath(context.workspace, this.pathStyle) + ':/workspace',
      '--volume',
      volumePath(context.taskDir, this.pathStyle) + ':/task:ro',
      '--volume',
      volumePath(context.trialDir, this.pathStyle) + ':/run',
      '--volume',
      volumePath(context.evalRoot, this.pathStyle) + ':/eval:ro',
    ];
    if (environment.network === 'disabled') args.push('--network', 'none');
    if (Number.isFinite(environment.cpu)) args.push('--cpus', String(environment.cpu));
    if (Number.isFinite(environment.memory_mb)) args.push('--memory', String(environment.memory_mb) + 'm');
    if (environment.read_only_root === true) args.push('--read-only');
    for (const [key, value] of Object.entries(command.env || {})) {
      args.push('--env', key + '=' + value);
    }
    args.push(imageDigest || configuredImage, command.command, ...command.args);
    const result = await runProcess({
      command: this.command,
      args,
      cwd: context.trialDir,
      env: process.env,
      input: command.input,
      timeoutMs: context.timeoutMs,
      onStdout: context.onStdout,
      onStderr: context.onStderr,
    });
    if (!imageDigest) imageDigest = await this.resolveImage(configuredImage, context.trialDir);
    result.imageDigest = imageDigest;
    result.configuredImage = configuredImage;
    return result;
  }
}
