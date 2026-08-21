import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { dockerCliCandidates, dockerDesktopCandidates, findDockerCli, findDockerDesktop, prerequisiteAction } from '../../src/core/desktop-runtime.mjs';

const environment = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };

test('desktop runtime recognizes supported per-user and all-user Docker locations', () => {
  const cli = dockerCliCandidates(environment);
  const desktop = dockerDesktopCandidates(environment);
  assert.ok(cli.includes(path.win32.normalize('C:\\Users\\test\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe')));
  assert.ok(cli.includes(path.win32.normalize('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe')));
  assert.ok(desktop.includes(path.win32.normalize('C:\\Users\\test\\AppData\\Local\\Programs\\DockerDesktop\\Docker Desktop.exe')));
  assert.ok(desktop.includes(path.win32.normalize('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')));
  assert.equal(findDockerCli({ environment, fileExists: (candidate) => candidate === cli[0] }), cli[0]);
  assert.equal(findDockerDesktop({ environment, fileExists: (candidate) => candidate === desktop.at(-1) }), desktop.at(-1));
});

test('prerequisite actions contain only fixed official URLs or a fixed start action', () => {
  assert.match(prerequisiteAction('install-docker').url, /^https:\/\/docs\.docker\.com\//);
  assert.match(prerequisiteAction('install-wsl').url, /^https:\/\/learn\.microsoft\.com\//);
  assert.equal(prerequisiteAction('start-docker').url, undefined);
  assert.equal(prerequisiteAction('arbitrary-command'), null);
});
