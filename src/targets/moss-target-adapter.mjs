import { hashObject } from '../lib/json.mjs';
import { collectMossNativeTelemetry } from '../core/native-telemetry.mjs';
import { detectMossHarness, inspectHarness } from '../core/harness-inspection.mjs';

export const MOSS_PREPARED_CLI = '/target/packages/moss-agent/dist/cli.js';

export class MossTargetAdapter {
  id = 'moss';
  version = '1.0.0';
  apiVersion = '1.0';

  isCompatible(inspection) {
    return inspection?.candidates?.some((candidate) => candidate.adapter === this.id) ||
      inspection?.manifest?.adapter?.id === this.id;
  }

  async inspect(sourceRecord) {
    const inspection = await inspectHarness(sourceRecord);
    return {
      inspection,
      detection: await detectMossHarness(sourceRecord.snapshot_path),
    };
  }

  createPreparationPlan(context) {
    return {
      schema_version: '1.0',
      adapter: this.id,
      source_fingerprint: context.sourceRecord.snapshot_fingerprint,
      runtime: { kind: 'node', version: context.nodeVersion || '>=22.16.0' },
      working_directory: '.',
      steps: [
        { command: 'npm', args: ['ci'], network: true },
        { command: 'npm', args: ['run', 'build', '--workspace', '@rdk-moss/agent'], network: false },
        { command: 'node', args: ['packages/moss-agent/dist/cli.js', '--version'], network: false },
      ],
      output: { command: 'node', args: [MOSS_PREPARED_CLI] },
    };
  }

  createLaunch(context) {
    return {
      command: 'node',
      args: [MOSS_PREPARED_CLI, ...(context.args || [])],
      input: context.input ?? null,
      protocol: context.mode,
      cwd: '/workspace',
      env: { MOSS_EVAL_RUNTIME_MODE: context.mode },
      image: context.preparedTarget.image_digest,
    };
  }

  collectTelemetry(workspace, options = {}) {
    return collectMossNativeTelemetry(workspace, options);
  }

  describeCapabilities() {
    return {
      modes: ['one-shot', 'stream-json', 'pty', 'acp'],
      telemetry_level: 'L3',
      tools: [],
      tags: ['coding-repository', 'mcp', 'skills', 'subagents', 'recovery'],
    };
  }

  fingerprint(context = {}) {
    return hashObject({
      id: this.id,
      version: this.version,
      api_version: this.apiVersion,
      source_fingerprint: context.sourceFingerprint || null,
      configuration: context.configuration || null,
    });
  }
}
