const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const OPERATIONS = new Set(['doctor', 'source:addGithub', 'source:addLocal', 'inspect', 'prepare', 'prepare:cancel', 'run:start', 'run:cancel', 'run:list', 'run:get', 'run:export', 'tasks:list', 'settings:get', 'settings:update', 'dialog:selectDirectory']);

function object(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`); return value; }
function id(value, name) { if (!ID.test(String(value || ''))) throw new Error(`${name} is invalid`); return String(value); }

export function validateIpcRequest(operation, payload = {}) {
  if (!OPERATIONS.has(operation)) throw new Error('IPC operation is not allowed');
  const value = object(payload, 'payload');
  if (['run:cancel', 'run:get', 'run:export'].includes(operation)) id(value.run_id, 'run_id');
  if (operation === 'prepare:cancel') id(value.preparation_id, 'preparation_id');
  if (operation === 'run:export' && value.format !== undefined && !['json', 'markdown'].includes(value.format)) throw new Error('Unsupported export format');
  if (operation === 'run:start') {
    id(value.config_id, 'config_id');
    if (value.trials !== undefined && (!Number.isInteger(value.trials) || value.trials < 1 || value.trials > 20)) throw new Error('trials must be between 1 and 20');
    if (value.concurrency !== undefined && (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 8)) throw new Error('concurrency must be between 1 and 8');
  }
  if (operation === 'source:addGithub' && !/^https:\/\/github\.com\//i.test(String(value.url || ''))) throw new Error('Only public GitHub HTTPS URLs are supported');
  if (operation === 'settings:update') {
    const allowed = new Set(['theme', 'retention_days', 'default_trials']);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Unknown setting');
  }
  return structuredClone(value);
}

export const IPC_OPERATIONS = Object.freeze([...OPERATIONS]);
