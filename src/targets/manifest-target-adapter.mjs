import { hashObject } from '../lib/json.mjs';
import { inspectHarness } from '../core/harness-inspection.mjs';
import { unavailableNativeTelemetry } from '../core/native-telemetry.mjs';
import { validateHarnessManifest } from '../core/harness-schema.mjs';

export class ManifestTargetAdapter {
  id = 'manifest-command';
  version = '1.0.0';
  apiVersion = '1.0';

  isCompatible(inspection) {
    return inspection?.manifest?.adapter?.id === this.id;
  }

  async inspect(sourceRecord) {
    return inspectHarness(sourceRecord);
  }

  manifest(context) {
    return validateHarnessManifest(context.manifest || context.configuration, '<effective-manifest>');
  }

  createPreparationPlan(context) {
    const manifest = this.manifest(context);
    return {
      schema_version: '1.0',
      adapter: this.id,
      source_fingerprint: context.sourceRecord.snapshot_fingerprint,
      runtime: { kind: manifest.runtime },
      working_directory: manifest.preparation?.working_directory || '.',
      steps: structuredClone(manifest.preparation?.steps || []),
      output: { command: manifest.launch.command },
    };
  }

  createLaunch(context) {
    const manifest = this.manifest(context);
    return {
      command: manifest.launch.command,
      args: [...(manifest.launch.args || []), ...(context.args || [])],
      input: context.input ?? null,
      protocol: manifest.launch.protocol,
      cwd: manifest.launch.working_directory || '.',
      env: {},
      image: context.preparedTarget.image_digest,
    };
  }

  async collectTelemetry() {
    return unavailableNativeTelemetry('manifest-adapter');
  }

  describeCapabilities(context = {}) {
    if (context.manifest || context.configuration) {
      return structuredClone(this.manifest(context).capabilities);
    }
    return { modes: [], telemetry_level: 'L0', tools: [], tags: [] };
  }

  fingerprint(context = {}) {
    return hashObject({
      id: this.id,
      version: this.version,
      api_version: this.apiVersion,
      source_fingerprint: context.sourceFingerprint || null,
      manifest: context.manifest || context.configuration || null,
    });
  }
}
