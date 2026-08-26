const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const OPERATIONS = new Set(['doctor', 'prerequisite:remediate', 'source:addGithub', 'source:addLocal', 'inspect', 'prepare', 'prepare:cancel', 'model:testConnection', 'run:start', 'run:cancel', 'run:list', 'run:get', 'run:export', 'tasks:list', 'settings:get', 'settings:update', 'dialog:selectDirectory']);
const PREREQUISITE_ACTIONS = new Set(['install-docker', 'install-wsl', 'virtualization-help', 'start-docker']);
const MODEL_PROVIDERS = new Set(['deepseek', 'qwen', 'openai', 'anthropic', 'openai-compatible']);
const MODEL_PROTOCOLS = new Set(['auto', 'openai-compatible', 'anthropic']);

function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value; }
function id(value, name) { if (!ID.test(String(value || ''))) throw new Error(`${name} is invalid`); return String(value); }
function modelConfiguration(value) {
  object(value, 'model_configuration');
  const allowed = new Set(['provider', 'protocol', 'model', 'base_url', 'api_key']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Unknown model configuration field');
  if (value.provider !== undefined && !MODEL_PROVIDERS.has(value.provider)) throw new Error('Unsupported model provider');
  if (value.protocol !== undefined && !MODEL_PROTOCOLS.has(value.protocol)) throw new Error('Unsupported model protocol');
  for (const [key, maximum] of [['model', 256], ['base_url', 2048], ['api_key', 4096]]) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > maximum || /[\0\r\n]/.test(value[key])) throw new Error(`${key} is invalid`);
  }
  if (!/^https:\/\//i.test(value.base_url)) throw new Error('base_url must use HTTPS');
}

export function validateIpcRequest(operation, payload = {}) {
  if (!OPERATIONS.has(operation)) throw new Error('IPC operation is not allowed');
  const value = object(payload, 'payload');
  if (['run:cancel', 'run:get', 'run:export'].includes(operation)) id(value.run_id, 'run_id');
  if (operation === 'prepare:cancel') id(value.preparation_id, 'preparation_id');
  if (operation === 'prerequisite:remediate' && !PREREQUISITE_ACTIONS.has(value.action)) throw new Error('Unsupported prerequisite action');
  if (operation === 'run:export' && value.format !== undefined && !['json', 'markdown'].includes(value.format)) throw new Error('Unsupported export format');
  if (operation === 'run:start') {
    id(value.config_id, 'config_id');
    if (value.trials !== undefined && (!Number.isInteger(value.trials) || value.trials < 1 || value.trials > 20)) throw new Error('trials must be between 1 and 20');
    if (value.concurrency !== undefined && (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 8)) throw new Error('concurrency must be between 1 and 8');
    if (value.model_configuration !== undefined) modelConfiguration(value.model_configuration);
    if (value.approve_agent_workspace_actions !== undefined && typeof value.approve_agent_workspace_actions !== 'boolean') throw new Error('approve_agent_workspace_actions must be a boolean');
  }
  if (operation === 'model:testConnection') {
    id(value.target_fingerprint, 'target_fingerprint');
    modelConfiguration(value.model_configuration);
    if (value.approve_runtime_network !== true) throw new Error('Runtime network authorization is required');
  }
  if (operation === 'source:addGithub' && !/^https:\/\/github\.com\//i.test(String(value.url || ''))) throw new Error('Only public GitHub HTTPS URLs are supported');
  if (operation === 'settings:update') {
    const allowed = new Set(['theme', 'retention_days', 'default_trials']);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Unknown setting');
  }
  return structuredClone(value);
}

export const IPC_OPERATIONS = Object.freeze([...OPERATIONS]);
