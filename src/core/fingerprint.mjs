import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hashObject } from '../lib/json.mjs';

const execFileAsync = promisify(execFile);

async function gitCommit(directory) {
  if (!directory) return null;
  try {
    const result = await execFileAsync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
      windowsHide: true,
      timeout: 5000,
    });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function publicTask(task) {
  const copy = structuredClone(task);
  delete copy._meta;
  if (copy.environment?.env) {
    copy.environment.env = Object.fromEntries(
      Object.keys(copy.environment.env).map((key) => [key, '[CONFIGURED]']),
    );
  }
  return copy;
}

export async function createFingerprint(task, agentName, agent, config, runnerName, runtime = {}) {
  const sourceCommit = agent.source_commit || await gitCommit(agent.source_dir || null);
  return {
    schema_version: '1.0',
    created_at: new Date().toISOString(),
    task_id: task.id,
    task_version: String(task.version),
    task_hash: hashObject(publicTask(task)),
    agent: agentName,
    adapter: agent.adapter,
    model: agent.model || null,
    provider: agent.provider || null,
    moss_version: agent.version || null,
    track: agent.track || 'release',
    moss_commit: sourceCommit,
    source: agent.source_repository || sourceCommit
      ? {
          repository: agent.source_repository || null,
          ref: agent.source_ref || null,
          commit: sourceCommit,
          dirty: agent.source_dirty ?? null,
          bootstrap: agent.source_bootstrap || null,
          snapshot_fingerprint: agent.source_snapshot_fingerprint || null,
        }
      : null,
    prepared_target: agent.prepared_target_fingerprint ? {
      fingerprint: agent.prepared_target_fingerprint,
      adapter: agent.prepared_target_adapter || null,
      sandbox_policy: agent.prepared_target_policy || null,
    } : null,
    prompt_policy_hash: agent.prompt_policy_hash || null,
    tool_schema_hash: agent.tool_schema_hash || null,
    runner: runnerName,
    image: task.environment.image || null,
    image_digest: runtime.imageDigest || task.environment.image_digest || null,
    resources: {
      cpu: task.environment.cpu || null,
      memory_mb: task.environment.memory_mb || null,
      disk_mb: task.environment.disk_mb || null,
      timeout_seconds: task.environment.timeout_seconds,
      network: task.environment.network,
    },
    budget: task.budget,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    operating_system: os.release(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    config_hash: hashObject({
      schema_version: config.schema_version,
      default_runner: config.default_runner,
      execution: config.execution,
    }),
  };
}
