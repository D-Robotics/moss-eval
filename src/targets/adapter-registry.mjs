import { ADAPTER_API_VERSION } from '../core/harness-schema.mjs';

const REQUIRED_METHODS = [
  'isCompatible',
  'inspect',
  'createPreparationPlan',
  'createLaunch',
  'collectTelemetry',
  'describeCapabilities',
  'fingerprint',
];

export class TargetAdapterRegistry {
  constructor(options = {}) {
    this.apiVersion = options.apiVersion || ADAPTER_API_VERSION;
    this.adapters = new Map();
  }

  register(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new Error('Adapter must be an object');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(adapter.id || '')) throw new Error('Adapter id is invalid');
    if (adapter.apiVersion !== this.apiVersion) {
      throw new Error(`Adapter ${adapter.id} API ${adapter.apiVersion} is incompatible with registry API ${this.apiVersion}`);
    }
    if (typeof adapter.version !== 'string' || adapter.version.length === 0) throw new Error(`Adapter ${adapter.id} version is required`);
    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== 'function') throw new Error(`Adapter ${adapter.id} is missing ${method}()`);
    }
    if (this.adapters.has(adapter.id)) throw new Error(`Adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }

  get(id) {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      const error = new Error(`Target adapter is not installed: ${id}`);
      error.code = 'TARGET_ADAPTER_NOT_FOUND';
      throw error;
    }
    return adapter;
  }

  compatible(inspection) {
    return [...this.adapters.values()].filter((adapter) => adapter.isCompatible(inspection));
  }

  describe() {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      version: adapter.version,
      api_version: adapter.apiVersion,
      capabilities: adapter.describeCapabilities(),
    }));
  }
}
