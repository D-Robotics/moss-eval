import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopDoctor } from '../../src/core/doctor.mjs';

test('desktop doctor distinguishes a missing Docker CLI from a healthy WSL2 runtime', async () => {
  const processRunner = async (spec) => {
    if (spec.command === 'wsl.exe') {
      return { exitCode: 0, startError: null, timedOut: false, stdout: 'Default Version: 2', stderr: '' };
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
  const docker = result.checks.find((check) => check.id === 'docker-runtime');
  assert.equal(docker.status, 'fail');
  assert.match(docker.detail, /not installed/);
});

test('desktop doctor reports daemon remediation separately when Docker CLI is installed', async () => {
  const processRunner = async (spec) => spec.command === 'wsl.exe'
    ? { exitCode: 0, startError: null, timedOut: false, stdout: 'WSL2', stderr: '' }
    : { exitCode: 1, startError: null, timedOut: false, stdout: '', stderr: 'daemon unavailable' };
  const result = await desktopDoctor({
    platform: 'win32', architecture: 'x64', processRunner, minimumDiskBytes: 1,
  });
  const docker = result.checks.find((check) => check.id === 'docker-runtime');
  assert.match(docker.detail, /daemon unavailable/);
  assert.match(docker.remediation, /Start the Docker daemon/);
});
