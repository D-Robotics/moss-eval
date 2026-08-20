import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { hashObject, readJson, writeJson } from '../lib/json.mjs';
import { createBuiltInTargetRegistry } from '../targets/index.mjs';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function wslPath(value) {
  const absolute = path.resolve(value);
  const match = /^([A-Za-z]):\\(.*)$/.exec(absolute);
  if (!match) throw new Error(`Cannot convert path to WSL: ${absolute}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

function shortCommit(commit) {
  return commit.slice(0, 12);
}

async function dockerImageDigest(distro, image) {
  const result = await run('wsl', [
    '--distribution', distro, '--exec', 'sudo', 'docker',
    'image', 'inspect', image, '--format', '{{.Id}}',
  ], { capture: true });
  const digest = `${result.stdout}\n${result.stderr}`.match(/sha256:[0-9a-f]{64}/i)?.[0];
  if (!digest) throw new Error(`Unable to resolve Docker image digest for ${image}`);
  return digest.toLowerCase();
}

async function gitOutput(args, cwd = undefined) {
  const result = await run('git', args, { cwd, capture: true });
  return result.stdout.trim();
}

export async function resolveRemoteCommit(repository, ref) {
  const candidates = ref === 'HEAD'
    ? ['HEAD']
    : [ref, `refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`];
  for (const candidate of candidates) {
    const output = await gitOutput(['ls-remote', repository, candidate]);
    const line = output.split(/\r?\n/).find(Boolean);
    if (line) return line.split(/\s+/)[0];
  }
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  throw new Error(`Unable to resolve ${ref} at ${repository}`);
}

async function ensureCheckout(repository, commit, checkout) {
  try {
    const existing = await gitOutput(['-C', checkout, 'rev-parse', 'HEAD']);
    if (existing !== commit) throw new Error(`Cached checkout is ${existing}, expected ${commit}`);
  } catch (error) {
    if (!String(error.message).includes('not a git repository') &&
        !String(error.message).includes('cannot change to') &&
        !String(error.message).includes('Cannot change to') &&
        !String(error.message).includes('No such file')) throw error;
    await fsp.mkdir(path.dirname(checkout), { recursive: true });
    await run('git', ['init', checkout]);
    await run('git', ['-C', checkout, 'remote', 'add', 'origin', repository]);
    await run('git', ['-C', checkout, 'fetch', '--depth', '1', 'origin', commit]);
    await run('git', ['-C', checkout, 'checkout', '--detach', 'FETCH_HEAD']);
  }
  const actual = await gitOutput(['-C', checkout, 'rev-parse', 'HEAD']);
  if (actual !== commit) throw new Error(`Checked out ${actual}, expected ${commit}`);
  const dirty = await gitOutput(['-C', checkout, 'status', '--porcelain']);
  if (dirty) throw new Error(`Source checkout is dirty: ${checkout}`);
}

export function createSourceConfig(base, details) {
  const config = structuredClone(base);
  config.evaluation_root = details.evaluationRoot;
  config.output_root = path.join(details.evaluationRoot, '.moss-eval', 'runs');
  config.task_roots = [path.join(details.evaluationRoot, 'taskpacks', 'core')];
  config.execution.environment_overrides = {
    ...(config.execution.environment_overrides || {}),
    network: 'public',
    image: details.image,
  };
  const release = config.agents.moss;
  config.agents = {
    moss: {
      ...release,
      version: details.version,
      track: 'source',
      source_repository: details.repository,
      source_ref: details.ref,
      source_commit: details.commit,
      source_dir: details.checkout,
      source_dirty: false,
      source_bootstrap: `zero-config-default from official npm release image ${details.baseImageDigest || 'digest-unavailable'}`,
    },
    reference: config.agents.reference,
  };
  return config;
}

export async function prepareSourceTrack(options = {}) {
  const evaluationRoot = path.resolve(options.evaluationRoot || process.cwd());
  const repository = options.repository || 'https://github.com/D-Robotics/moss.git';
  const ref = options.ref || 'main';
  const commit = options.commit || await resolveRemoteCommit(repository, ref);
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`Invalid commit: ${commit}`);
  const short = shortCommit(commit);
  const checkout = path.join(evaluationRoot, '.moss-eval', 'sources', 'moss', commit);
  const trackRoot = path.join(evaluationRoot, '.moss-eval', 'source-track', short);
  const context = path.join(trackRoot, 'context');
  const archive = path.join(context, 'source.tar');
  const image = `moss-eval-source:${short}`;
  await ensureCheckout(repository, commit, checkout);
  await fsp.mkdir(context, { recursive: true });
  await run('git', ['-C', checkout, 'archive', '--format=tar', `--output=${archive}`, commit]);

  const packageJson = await readJson(path.join(checkout, 'packages', 'moss-agent', 'package.json'));
  const dockerfile = path.join(evaluationRoot, 'Dockerfile.source');
  const distro = options.distro || 'RDK-Moss-Ubuntu';
  const baseImage = options.baseImage || 'moss-eval:local';
  const baseImageDigest = await dockerImageDigest(distro, baseImage);
  await run('wsl', [
    '--distribution', distro, '--exec', 'sudo', 'docker', 'build',
    '--file', wslPath(dockerfile),
    '--build-arg', `MOSS_REPOSITORY=${repository}`,
    '--build-arg', `MOSS_REF=${ref}`,
    '--build-arg', `MOSS_COMMIT=${commit}`,
    '--build-arg', `BASE_IMAGE=${baseImage}`,
    '--build-arg', `BASE_IMAGE_DIGEST=${baseImageDigest}`,
    '--tag', image,
    wslPath(context),
  ]);
  await run('wsl', [
    '--distribution', distro, '--exec', 'sudo', 'docker', 'run', '--rm', image,
    'sh', '-lc', `test "$(cat /opt/moss-source-commit)" = "${commit}" && moss --version`,
  ]);
  const imageDigest = await dockerImageDigest(distro, image);

  const sourceFingerprint = hashObject({ repository, commit });
  const sourceRecord = {
    id: `legacy-source-${short}`,
    snapshot_fingerprint: sourceFingerprint,
    revision: commit,
    canonical_location: repository,
  };
  const adapter = createBuiltInTargetRegistry().get('moss');
  const preparationPlan = adapter.createPreparationPlan({ sourceRecord });
  const adapterFingerprint = adapter.fingerprint({ sourceFingerprint });

  const baseConfig = await readJson(path.join(evaluationRoot, 'configs', 'moss.wsl.example.json'));
  const config = createSourceConfig(baseConfig, {
    evaluationRoot, repository, ref, commit, checkout, image: imageDigest, version: packageJson.version,
    baseImageDigest,
  });
  const configFile = path.join(trackRoot, 'config.json');
  await writeJson(configFile, config);
  const manifest = {
    schema_version: '1.0',
    track: 'source',
    created_at: new Date().toISOString(),
    repository,
    ref,
    commit,
    checkout,
    source_archive: archive,
    version: packageJson.version,
    image,
    image_digest: imageDigest,
    adapter: {
      id: adapter.id,
      version: adapter.version,
      api_version: adapter.apiVersion,
      fingerprint: adapterFingerprint,
    },
    source_fingerprint: sourceFingerprint,
    preparation_plan: preparationPlan,
    capabilities: adapter.describeCapabilities(),
    base_image: baseImage,
    base_image_digest: baseImageDigest,
    config: configFile,
    bootstrap: 'zero-config-default from official npm release image; runtime and CLI compiled from source commit',
  };
  await writeJson(path.join(trackRoot, 'source-manifest.json'), manifest);
  return manifest;
}
