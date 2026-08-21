import { existsSync } from 'node:fs';
import path from 'node:path';

export const PREREQUISITE_ACTIONS = Object.freeze({
  'install-docker': {
    label: '下载并安装 Docker Desktop',
    url: 'https://docs.docker.com/desktop/setup/install/windows-install/',
  },
  'install-wsl': {
    label: '查看 WSL2 安装步骤',
    url: 'https://learn.microsoft.com/windows/wsl/install',
  },
  'virtualization-help': {
    label: '查看虚拟化启用步骤',
    url: 'https://learn.microsoft.com/windows-server/virtualization/hyper-v/system-requirements-for-hyper-v-on-windows',
  },
  'start-docker': {
    label: '启动 Docker Desktop',
  },
});

function compact(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.normalize(value)))];
}

export function dockerCliCandidates(environment = process.env) {
  return compact([
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
    environment.ProgramFiles && path.join(environment.ProgramFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
  ]);
}

export function dockerDesktopCandidates(environment = process.env) {
  return compact([
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs', 'Docker', 'Docker', 'Docker Desktop.exe'),
    environment.ProgramFiles && path.join(environment.ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe'),
  ]);
}

export function findDockerCli(options = {}) {
  const fileExists = options.fileExists || existsSync;
  return dockerCliCandidates(options.environment).find((candidate) => fileExists(candidate)) || null;
}

export function findDockerDesktop(options = {}) {
  const fileExists = options.fileExists || existsSync;
  return dockerDesktopCandidates(options.environment).find((candidate) => fileExists(candidate)) || null;
}

export function prerequisiteAction(action) {
  return PREREQUISITE_ACTIONS[action] || null;
}
