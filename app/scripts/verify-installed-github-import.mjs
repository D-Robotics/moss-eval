import process from 'node:process';

const [webSocketUrl, repositoryUrl, timeoutArgument] = process.argv.slice(2);
if (!webSocketUrl || !repositoryUrl) {
  throw new Error('Usage: node verify-installed-github-import.mjs <websocket-url> <repository-url> [timeout-ms]');
}

const timeoutMs = Number(timeoutArgument || 180_000);
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
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

await command('Runtime.enable');
const started = await evaluate(`(() => {
  const input = document.getElementById('source-url');
  const button = document.getElementById('analyze-source');
  if (!input || !button) return { started: false, reason: 'source controls not found' };
  input.value = ${JSON.stringify(repositoryUrl)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  button.click();
  return { started: true, value: input.value, label: button.textContent };
})()`);

if (!started.started) throw new Error(started.reason);

const deadline = Date.now() + timeoutMs;
let state;
while (Date.now() < deadline) {
  state = await evaluate(`(() => {
    const button = document.getElementById('analyze-source');
    const status = document.getElementById('source-action-status');
    const inspection = document.getElementById('inspection-content');
    const summary = [...(inspection?.querySelectorAll('.summary-list dd') || [])].map((item) => item.textContent || '');
    return {
      button_busy: button?.dataset.busy === 'true',
      button_label: button?.textContent || '',
      status: status?.textContent || '',
      status_class: status?.className || '',
      field_error: document.getElementById('source-url-error')?.textContent || '',
      inspection_heading: inspection?.querySelector('h3')?.textContent || '',
      project: summary[0] || '',
      agent_type: summary[1] || '',
      entry_point: summary[2] || '',
      source_version: summary[3] || '',
    };
  })()`);
  if (!state.button_busy && /(?:success|failure)/.test(state.status_class)) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

socket.close();
if (!state || state.button_busy) throw new Error(`GitHub import did not finish within ${timeoutMs}ms`);
process.stdout.write(`${JSON.stringify({ started, final: state }, null, 2)}\n`);
if (!state.status_class.includes('success')) process.exitCode = 2;
