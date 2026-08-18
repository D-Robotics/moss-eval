import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'ssh2';

const distro = process.env.MOSS_EVAL_WSL_DISTRO || 'RDK-Moss-Ubuntu';
const image = 'moss-eval-device-sim:local';
const action = process.argv[2] || 'check';
const root = process.cwd();
const stateDir = path.join(root, '.moss-eval', 'device-sim');
const privateKey = path.join(stateDir, 'id_ed25519');

function toWslPath(value) {
  const resolved = path.resolve(value);
  const match = /^([A-Za-z]):\\(.*)$/.exec(resolved);
  if (!match) throw new Error(`cannot convert path to WSL: ${resolved}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

function docker(args, options = {}) {
  return execFileSync(
    'wsl',
    ['--distribution', distro, '--exec', 'sudo', 'docker', ...args],
    { encoding: 'utf8', stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' },
  );
}

function build() {
  docker(['build', '-f', `${toWslPath(root)}/Dockerfile.device-sim`, '-t', image, toWslPath(root)]);
}

function ensureKey() {
  mkdirSync(stateDir, { recursive: true });
  if (existsSync(privateKey)) return;
  const generated = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', privateKey], {
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error('ssh-keygen failed');
}

function openSshConnection(port) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.once('ready', () => resolve(client));
    client.once('error', reject);
    client.connect({
      host: '127.0.0.1',
      port: Number(port),
      username: 'evaluator',
      privateKey: readFileSync(privateKey),
      readyTimeout: 2_000,
      hostVerifier: () => true,
    });
  });
}

function runSshCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk) => { stdout += chunk; });
      stream.stderr.on('data', (chunk) => { stderr += chunk; });
      stream.once('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`remote command failed (${code}): ${stderr}`));
      });
    });
  });
}

async function check() {
  ensureKey();
  try {
    docker(['image', 'inspect', image], { capture: true });
  } catch {
    build();
  }
  const name = `moss-eval-device-${process.pid}`;
  const publicKey = readFileSync(`${privateKey}.pub`, 'utf8').trim();
  try {
    docker([
      'run', '--rm', '--detach', '--name', name,
      '--publish', '127.0.0.1::22', '--env', `AUTHORIZED_KEY=${publicKey}`, image,
    ], { capture: true });
    const portOutput = docker(['port', name, '22/tcp'], { capture: true }).trim();
    const port = portOutput.slice(portOutput.lastIndexOf(':') + 1);
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let client;
      try {
        client = await openSshConnection(port);
        const first = await runSshCommand(client, 'cat /etc/moss-eval-device');
        const second = await runSshCommand(client, 'printf reused-connection');
        client.end();
        if (first !== 'moss-eval-device-simulator' || second !== 'reused-connection') {
          throw new Error('SSH simulator returned unexpected results');
        }
        process.stdout.write(`${JSON.stringify({ ready: true, transport: 'ssh', endpoint: `127.0.0.1:${port}`, connection_reused: true })}\n`);
        return;
      } catch (error) {
        client?.end();
        lastError = error.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`SSH simulator did not become ready: ${lastError}`);
  } finally {
    try {
      docker(['rm', '--force', name], { capture: true });
    } catch {}
  }
}

if (action === 'build') build();
else if (action === 'check') await check();
else throw new Error(`unknown action: ${action}`);
