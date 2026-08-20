import { TargetAdapterRegistry } from './adapter-registry.mjs';
import { ManifestTargetAdapter } from './manifest-target-adapter.mjs';
import { MossTargetAdapter } from './moss-target-adapter.mjs';

export function createBuiltInTargetRegistry() {
  const registry = new TargetAdapterRegistry();
  registry.register(new MossTargetAdapter());
  registry.register(new ManifestTargetAdapter());
  return registry;
}

export { TargetAdapterRegistry } from './adapter-registry.mjs';
export { ManifestTargetAdapter } from './manifest-target-adapter.mjs';
export { MossTargetAdapter } from './moss-target-adapter.mjs';
