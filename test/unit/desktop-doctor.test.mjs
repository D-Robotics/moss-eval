import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopDoctor } from '../../src/core/doctor.mjs';

test('desktop doctor distinguishes a missing Docker CLI from a healthy WSL2 runtime', async () => {
  const processRunner = async (spec) => {
    if (spec.command === 'wsl.exe') {
      return { exitCode: 0, startError: null, timedOut: false, stdout: 'WSL version: 2.7.12.0', stderr: '' };
    }
    return {
      exitCode: null, timedOut: false, stdout: '', stderr: '',
      startError: { code: 'ENOENT', message: 'docker not found' },
    };
  };
  const result = await desktopDoctor({
    platform: 'win32', architecture: 'x64', osRelease: '11', processRunner,
    minimumDiskBytes: 1,
  });
  assert.equal(result.ready, false);
  assert.equal(result.source_inspection_available, true);
  assert.equal(result.checks.find((check) => check.id === 'wsl2').status, 'pass');
  const installation = result.checks.find((check) => check.id === 'docker-installation');
  assert.equal(installation.status, 'fail');
  assert.equal(installation.action, 'install-docker');
  const docker = result.checks.find((check) => check.id === 'docker-runtime');
  assert.equal(docker.status, 'fail');
  assert.match(docker.detail, /blocked until Docker Desktop is installed/);
});

test('desktop doctor reports daemon remediation separately when Docker CLI is installed', async () => {
  const processRunner = async (spec) => spec.command === 'wsl.exe'
    ? { exitCode: 0, startError: null, timedOut: false, stdout: 'WSL version: 2.7.12.0', stderr: '' }
    : { exitCode: 1, startError: null, timedOut: false, stdout: '', stderr: 'daemon unavailable' };
  const result = await desktopDoctor({
    platform: 'win32', architecture: 'x64', processRunner, minimumDiskBytes: 1,
  });
  const docker = result.checks.find((check) => check.id === 'docker-runtime');
  assert.match(docker.detail, /daemon unavailable/);
  assert.match(docker.remediation, /Start Docker Desktop/);
  assert.equal(docker.action, 'start-docker');
});

test('desktop doctor discovers a per-user Docker CLI when PATH does not contain docker', async () => {
  const discovered = 'C:\\Users\\test\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe';
  const calls = [];
  const processRunner = async (spec) => {
    calls.push(spec.command);
    if (spec.command === 'wsl.exe') return { exitCode: 0, startError: null, timedOut: false, stdout: 'WSL version: 2.7.12.0', stderr: '' };
    if (spec.command === 'powershell.exe') return { exitCode: 0, startError: null, timedOut: false, stdout: 'True', stderr: '' };
    if (spec.command === 'docker') return { exitCode: null, startError: { code: 'ENOENT', message: 'missing' }, timedOut: false, stdout: '', stderr: '' };
    if (spec.command === discovered) return { exitCode: 0, startError: null, timedOut: false, stdout: '29.7.2', stderr: '' };
    throw new Error(`Unexpected command: ${spec.command}`);
  };
  const result = await desktopDoctor({
    platform: 'win32', architecture: 'x64', processRunner, minimumDiskBytes: 1,
    environment: { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    fileExists: (candidate) => candidate === discovered,
  });
  assert.equal(result.ready, true);
  assert.equal(result.runtime.docker_command, discovered);
  assert.equal(result.checks.find((check) => check.id === 'docker-installation').status, 'pass');
  assert.ok(calls.includes(discovered));
});

test('desktop doctor rejects an obsolete WSL package even when the command exits successfully', async () => {
  const processRunner = async (spec) => {
    if (spec.command === 'wsl.exe') return { exitCode: 0, startError: null, timedOut: false, stdout: 'WSL version: 1.2.5.0', stderr: '' };
    if (spec.command === 'powershell.exe') return { exitCode: 0, startError: null, timedOut: false, stdout: 'True', stderr: '' };
    return { exitCode: 0, startError: null, timedOut: false, stdout: '29.7.2', stderr: '' };
  };
  const result = await desktopDoctor({ platform: 'win32', architecture: 'x64', processRunner, minimumDiskBytes: 1, dockerCommand: 'docker' });
  const wsl = result.checks.find((check) => check.id === 'wsl2');
  assert.equal(wsl.status, 'fail');
  assert.match(wsl.detail, /below the required 2\.1\.5/);
  assert.equal(wsl.action, 'install-wsl');
  assert.equal(result.ready, false);
});
