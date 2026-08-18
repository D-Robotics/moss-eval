import { CommandAdapter } from './command.mjs';
import { MossAdapter } from './moss.mjs';

export function createAdapter(name, configuration) {
  if (configuration.adapter === 'moss') return new MossAdapter(name, configuration);
  if (configuration.adapter === 'command' || configuration.adapter === 'mock') {
    return new CommandAdapter(name, configuration);
  }
  throw new Error('Unsupported adapter: ' + configuration.adapter);
}
