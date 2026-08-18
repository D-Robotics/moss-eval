import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../lib/json.mjs';
import { resolveRelative } from '../lib/paths.mjs';

const DEFAULTS = {
  schema_version: '1.0',
  output_root: '.moss-eval/runs',
  task_roots: ['taskpacks'],
  default_runner: 'docker',
  execution: {
    concurrency: 1,
    trials: null,
    k: 3,
    valid_trial_threshold: 0.95,
  },
  runners: {
    local: { allow: false },
    docker: { command: 'docker' },
    pty: {},
  },
  agents: {},
};

function mergeObjects(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = mergeObjects(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolveEnvironmentValue(value) {
  if (typeof value !== 'string') return value;
  const match = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!match) return value;
  return process.env[match[1]] || '';
}

export function resolveRuntimeEnvironment(environment = {}) {
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [key, resolveEnvironmentValue(value)]),
  );
}

export async function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const directory = path.dirname(absolutePath);
  const raw = await readJson(absolutePath);
  const config = mergeObjects(DEFAULTS, raw);

  if (config.schema_version !== '1.0') {
    throw new Error('Unsupported config schema_version: ' + config.schema_version);
  }
  if (!config.agents || Object.keys(config.agents).length === 0) {
    throw new Error('Config must define at least one agent');
  }
  for (const [name, agent] of Object.entries(config.agents)) {
    if (!agent.adapter) throw new Error('Agent ' + name + ' is missing adapter');
    if (!agent.command && agent.adapter !== 'mock') {
      throw new Error('Agent ' + name + ' is missing command');
    }
    agent._config_directory = directory;
  }

  config._meta = {
    file: absolutePath,
    directory,
    evaluationRoot: resolveRelative(directory, config.evaluation_root || '..'),
  };
  config.output_root = resolveRelative(directory, config.output_root);
  config.task_roots = config.task_roots.map((item) => resolveRelative(directory, item));
  if (config.project_root) config.project_root = resolveRelative(directory, config.project_root);
  if (config.judge?.api_key) config.judge.api_key = resolveEnvironmentValue(config.judge.api_key);
  if (config.integrations?.agent_eval_service?.headers) {
    config.integrations.agent_eval_service.headers = resolveRuntimeEnvironment(
      config.integrations.agent_eval_service.headers,
    );
  }

  await fsp.mkdir(config.output_root, { recursive: true });
  return config;
}

export function publicConfig(config) {
  const agents = Object.fromEntries(
    Object.entries(config.agents).map(([name, agent]) => [
      name,
      {
        adapter: agent.adapter,
        command: agent.command,
        args: agent.args || [],
        model: agent.model || null,
        provider: agent.provider || null,
        track: agent.track || 'release',
        source_repository: agent.source_repository || null,
        source_commit: agent.source_commit || null,
      },
    ]),
  );
  return {
    schema_version: config.schema_version,
    default_runner: config.default_runner,
    execution: config.execution,
    agents,
  };
}
