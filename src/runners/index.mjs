import { DockerRunner } from './docker.mjs';
import { LocalRunner } from './local.mjs';
import { PtyRunner } from './pty.mjs';

export function createRunner(name, configuration, options = {}) {
  if (name === 'local') return new LocalRunner(configuration.local, options);
  if (name === 'docker') return new DockerRunner(configuration.docker);
  if (name === 'pty') return new PtyRunner(configuration.pty);
  throw new Error('Unsupported runner: ' + name);
}
