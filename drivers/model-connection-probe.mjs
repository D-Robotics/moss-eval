import fsp from 'node:fs/promises';

function apiUrl(baseUrl, endpoint) {
  const base = String(baseUrl).trim().replace(/\/+$/, '').replace(/\/(?:v1\/)?(?:chat\/completions|completions|messages)$/i, '').replace(/\/v1$/i, '');
  return `${base}/v1/${endpoint}`;
}

function safeMessage(error) {
  const code = error?.cause?.code || error?.code || error?.name || 'CONNECTION_ERROR';
  return String(code).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'CONNECTION_ERROR';
}

const configPath = process.argv[2];
const started = Date.now();
try {
  const config = JSON.parse(await fsp.readFile(configPath, 'utf8'));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;
  try {
    if (config.provider === 'anthropic') {
      response = await fetch(apiUrl(config.baseUrl, 'messages'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply OK.' }] }),
        signal: controller.signal,
      });
    } else {
      response = await fetch(apiUrl(config.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply OK.' }], stream: false }),
        signal: controller.signal,
      });
    }
  } finally { clearTimeout(timeout); }
  const result = { schema_version: '1.0', ok: response.ok, status: response.status, latency_ms: Date.now() - started };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = response.ok ? 0 : 2;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ schema_version: '1.0', ok: false, status: null, latency_ms: Date.now() - started, error_code: safeMessage(error) })}\n`);
  process.exitCode = 3;
}
