import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const [webSocketUrl, sourceDirectory] = process.argv.slice(2);
if (!webSocketUrl || !sourceDirectory) {
  throw new Error('Usage: node verify-installed-full-flow.mjs <websocket-url> <source-directory>');
}

const model = {
  base_url: process.env.MOSS_E2E_BASE_URL || '',
  api_key: process.env.MOSS_E2E_API_KEY || '',
  model: process.env.MOSS_E2E_MODEL || '',
  protocol: process.env.MOSS_E2E_PROTOCOL || 'auto',
};
const taskId = process.env.MOSS_E2E_TASK_ID || '';
const socket = new WebSocket(webSocketUrl);
const pending = new Map();
let nextId = 1;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('Could not connect to Electron DevTools')), { once: true });
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await evaluate(expression);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} did not finish within ${timeoutMs}ms`);
}

await command('Runtime.enable');
await evaluate('location.reload(); true');
await waitFor("Boolean(document.getElementById('analyze-source'))", 20_000, 'renderer reload');

const imported = await evaluate(`(() => {
  document.querySelectorAll('.source-mode')[1].click();
  const input = document.getElementById('source-local');
  input.value = ${JSON.stringify(path.resolve(sourceDirectory))};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('analyze-source').click();
  return { source_mode: document.querySelectorAll('.source-mode')[1].getAttribute('aria-pressed'), path_set: Boolean(input.value) };
})()`);
const inspection = await waitFor(`(() => {
  const button = document.getElementById('analyze-source');
  const status = document.getElementById('source-action-status');
  if (button?.dataset.busy === 'true') return null;
  if (!/(?:success|failure)/.test(status?.className || '')) return null;
  return { status: status.textContent, status_class: status.className, heading: document.querySelector('#inspection-content h3')?.textContent || '' };
})()`, 180_000, 'local source import');
if (!inspection.status_class.includes('success')) throw new Error(`Local source import failed: ${inspection.status}`);

await evaluate("document.querySelector('#inspection-content .primary')?.click(); true");
await waitFor("document.getElementById('configure')?.hidden === false", 10_000, 'configuration navigation');

const configuration = await evaluate(`(() => {
  const set = (id, value) => {
    const control = document.getElementById(id);
    if (!control) throw new Error('Missing control: ' + id);
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else control.value = String(value);
    control.dispatchEvent(new Event(control.type === 'checkbox' ? 'change' : 'input', { bubbles: true }));
  };
  set('build-network', true);
  set('review-confirm', true);
  set('approve-runtime-network', ${Boolean(model.api_key)});
  set('approve-agent-actions', true);
  ${model.api_key ? `set('model-base-url', ${JSON.stringify(model.base_url)}); set('model-api-key', ${JSON.stringify(model.api_key)}); set('model-name', ${JSON.stringify(model.model)}); document.getElementById('model-protocol').value = ${JSON.stringify(model.protocol)}; document.getElementById('model-protocol').dispatchEvent(new Event('change', { bubbles: true }));` : ''}
  document.getElementById('prepare-target').click();
  return { model_configured: ${Boolean(model.api_key)}, review_confirmed: document.getElementById('review-confirm').checked };
})()`);
const preparation = await waitFor(`(() => {
  const button = document.getElementById('prepare-target');
  const status = document.getElementById('preparation-action-status');
  if (button?.dataset.busy === 'true') return null;
  if (!/(?:success|failure)/.test(status?.className || '')) return null;
  return { status: status.textContent, status_class: status.className, step: document.getElementById('preparation-step-state')?.textContent || '' };
})()`, 900_000, 'target preparation');
if (!preparation.status_class.includes('success')) throw new Error(`Target preparation failed: ${preparation.status}`);

let connection = null;
if (model.api_key) {
  await evaluate("document.getElementById('test-model-connection').click(); true");
  connection = await waitFor(`(() => {
    const button = document.getElementById('test-model-connection');
    const status = document.getElementById('model-connection-status');
    if (button?.dataset.busy === 'true') return null;
    if (!/(?:success|failure)/.test(status?.className || '')) return null;
    return { status: status.textContent, status_class: status.className };
  })()`, 90_000, 'model connection test');
  if (!connection.status_class.includes('success')) throw new Error(`Model connection failed: ${connection.status}`);
}

let run = null;
if (model.api_key && taskId) {
  const targetsRoot = path.join(
    process.env.MOSS_E2E_USER_DATA_ROOT || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'moss-eval-client'),
    'targets',
  );
  const targetDirectories = await fsp.readdir(targetsRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of targetDirectories.filter((item) => item.isDirectory())) {
    const file = path.join(targetsRoot, entry.name, 'prepared-target.json');
    try {
      const stat = await fsp.stat(file);
      const target = JSON.parse(await fsp.readFile(file, 'utf8'));
      candidates.push({ mtimeMs: stat.mtimeMs, target });
    } catch {}
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const preparedTarget = candidates[0]?.target;
  if (!preparedTarget?.target_fingerprint) throw new Error('Prepared target manifest was not found');
  await evaluate("window.__mossEvalE2EEvents = []; window.mossEval.onEvent((event) => window.__mossEvalE2EEvents.push(event)); true");
  const started = await evaluate(`window.mossEval.startRun(${JSON.stringify({
    config_id: 'moss.example.json',
    target_fingerprint: preparedTarget.target_fingerprint,
    approved_secret_names: [],
    approve_runtime_network: true,
    approve_agent_workspace_actions: true,
    model_configuration: model,
    suite: 'release',
    task_ids: [taskId],
    trials: 1,
    concurrency: 1,
    k: 1,
    randomize: false,
    minimum_telemetry_level: 'L3',
  })})`);
  const terminal = await waitFor(`(() => {
    const events = window.__mossEvalE2EEvents || [];
    const event = [...events].reverse().find((item) => ['run_completed', 'run_failed'].includes(item.type) && item.data?.run_id === ${JSON.stringify(started.run_id)});
    return event || null;
  })()`, 600_000, 'single-task evaluation');
  const artifacts = await evaluate(`window.mossEval.getRun(${JSON.stringify(started.run_id)})`);
  run = {
    run_id: started.run_id,
    terminal_type: terminal.type,
    status: artifacts?.metadata?.status || null,
    trial_count: artifacts?.trials?.length || 0,
    passed: artifacts?.trials?.[0]?.passed ?? null,
    failure_category: artifacts?.trials?.[0]?.failure_category || null,
  };
  if (terminal.type === 'run_failed') throw new Error(`Evaluation failed: ${terminal.data?.error || 'unknown error'}`);
}

socket.close();
process.stdout.write(`${JSON.stringify({ imported, inspection, configuration, preparation, connection, run }, null, 2)}\n`);
