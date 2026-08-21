export const MODEL_PROVIDER_PRESETS = Object.freeze({
  deepseek: Object.freeze({ id: 'deepseek', label: 'DeepSeek', default_model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com' }),
  qwen: Object.freeze({ id: 'qwen', label: 'Qwen', default_model: 'qwen3.6-plus', base_url: 'https://dashscope.aliyuncs.com/compatible-mode' }),
  openai: Object.freeze({ id: 'openai', label: 'OpenAI', default_model: 'gpt-4o-mini', base_url: 'https://api.openai.com' }),
  anthropic: Object.freeze({ id: 'anthropic', label: 'Anthropic', default_model: 'claude-sonnet-4-20250514', base_url: 'https://api.anthropic.com' }),
  'openai-compatible': Object.freeze({ id: 'openai-compatible', label: 'OpenAI Compatible', default_model: '', base_url: '' }),
});

export const MODEL_PROTOCOLS = Object.freeze(['auto', 'openai-compatible', 'anthropic']);

function boundedText(value, name, maximum, { required = true } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw Object.assign(new Error(`${name} is required`), { code: 'MODEL_CONFIGURATION_INVALID' });
  if (text.length > maximum || /[\0\r\n]/.test(text)) throw Object.assign(new Error(`${name} is invalid`), { code: 'MODEL_CONFIGURATION_INVALID' });
  return text;
}

function validatedBaseUrl(value) {
  const text = boundedText(value, 'base_url', 2048);
  let parsed;
  try { parsed = new URL(text); } catch { throw Object.assign(new Error('base_url must be a valid HTTPS URL'), { code: 'MODEL_CONFIGURATION_INVALID' }); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw Object.assign(new Error('base_url must be an HTTPS URL without credentials, query, or fragment'), { code: 'MODEL_CONFIGURATION_INVALID' });
  }
  return text.replace(/\/+$/, '');
}

function knownProvider(baseUrl) {
  const hostname = new URL(baseUrl).hostname.toLowerCase();
  if (hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic';
  if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) return 'deepseek';
  if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) return 'openai';
  if (hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.dashscope.aliyuncs.com')) return 'qwen';
  return null;
}

export function inferModelProtocol(baseUrl, override = 'auto') {
  const protocol = boundedText(override || 'auto', 'protocol', 64).toLowerCase();
  if (!MODEL_PROTOCOLS.includes(protocol)) throw Object.assign(new Error('Unsupported model protocol'), { code: 'MODEL_CONFIGURATION_INVALID' });
  if (protocol !== 'auto') return protocol;
  const normalized = validatedBaseUrl(baseUrl);
  return knownProvider(normalized) === 'anthropic' ? 'anthropic' : 'openai-compatible';
}

export function publicModelConfiguration(input) {
  if (!input) return null;
  return {
    provider: input.provider,
    protocol: input.protocol,
    model: input.model,
    base_url: input.baseUrl,
    api_key_configured: Boolean(input.apiKey),
  };
}

export function validateModelConfiguration(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('model_configuration must be an object'), { code: 'MODEL_CONFIGURATION_INVALID' });
  const model = boundedText(input.model, 'model', 256);
  const baseUrl = validatedBaseUrl(input.base_url ?? input.baseUrl);
  const legacyProvider = String(input.provider ?? '').trim().toLowerCase();
  if (legacyProvider && !MODEL_PROVIDER_PRESETS[legacyProvider]) throw Object.assign(new Error('Unsupported model provider'), { code: 'MODEL_CONFIGURATION_INVALID' });
  const requestedProtocol = input.protocol ?? (legacyProvider === 'anthropic' ? 'anthropic' : 'auto');
  const protocol = inferModelProtocol(baseUrl, requestedProtocol);
  const inferredProvider = knownProvider(baseUrl);
  const provider = protocol === 'anthropic'
    ? 'anthropic'
    : (legacyProvider && legacyProvider !== 'anthropic' ? legacyProvider : (inferredProvider && inferredProvider !== 'anthropic' ? inferredProvider : 'openai-compatible'));
  const apiKey = boundedText(input.api_key ?? input.apiKey, 'api_key', 4096, { required: options.requireApiKey !== false });
  return Object.freeze({ provider, protocol, model, baseUrl, apiKey });
}

export function mossConfigFile(configuration) {
  return JSON.stringify({
    provider: configuration.provider,
    model: configuration.model,
    baseUrl: configuration.baseUrl,
    apiKey: configuration.apiKey,
  });
}
