export const PRIMARY_STEPS = Object.freeze([
  Object.freeze({ id: 'source', number: 1, label: '选择 Agent' }),
  Object.freeze({ id: 'configure', number: 2, label: '配置评测' }),
  Object.freeze({ id: 'live', number: 3, label: '运行与结果' }),
]);

export const SECONDARY_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'history', label: '历史记录' }),
  Object.freeze({ id: 'report', label: '报告与对比' }),
]);

export function workflowReadiness(state = {}) {
  const sourceReady = Boolean(state.sourceRecord && state.inspection);
  const environmentReady = Boolean(state.prepared?.target);
  return Object.freeze({ source: true, configure: sourceReady, live: environmentReady || Boolean(state.activeRun) });
}

export function guardStep(target, state = {}) {
  const readiness = workflowReadiness(state);
  if (target === 'configure' && !readiness.configure) {
    return Object.freeze({ allowed: false, redirect: 'source', message: '请先选择并分析要评测的 Agent', focus_id: state.sourceMode === 'local' ? 'choose-local-source' : 'source-url' });
  }
  if (target === 'live' && !readiness.live) {
    if (!readiness.configure) return Object.freeze({ allowed: false, redirect: 'source', message: '请先选择并分析要评测的 Agent', focus_id: state.sourceMode === 'local' ? 'choose-local-source' : 'source-url' });
    return Object.freeze({ allowed: false, redirect: 'configure', message: '请先完成评测配置并准备评测环境', focus_id: 'prepare-target' });
  }
  return Object.freeze({ allowed: true, redirect: target, message: null, focus_id: null });
}

export function validateSourceSelection({ mode, url, directory }) {
  if (mode === 'local' && !String(directory || '').trim()) return Object.freeze({ field: 'source-local', message: '请先选择电脑上的 Agent 项目文件夹' });
  if (mode !== 'local' && !String(url || '').trim()) return Object.freeze({ field: 'source-url', message: '请输入公开 GitHub 仓库地址' });
  if (mode !== 'local' && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(String(url).trim())) {
    return Object.freeze({ field: 'source-url', message: '请输入仓库主页地址，例如 https://github.com/D-Robotics/moss' });
  }
  return null;
}

export function validateModelInputs({ model, baseUrl, apiKey, networkApproved }) {
  if (!String(baseUrl || '').trim()) return Object.freeze({ field: 'model-base-url', message: '请输入模型服务的 Base URL' });
  if (!String(apiKey || '').trim()) return Object.freeze({ field: 'model-api-key', message: '请输入 API Key。它只用于本次评测，不会保存' });
  if (!String(model || '').trim()) return Object.freeze({ field: 'model-name', message: '请输入要使用的模型名称' });
  if (!networkApproved) return Object.freeze({ field: 'approve-runtime-network', message: '请允许本次评测访问模型公网，否则无法连接模型服务' });
  return null;
}

export function inferApiProtocol(baseUrl, override = 'auto') {
  if (override === 'anthropic') return 'anthropic';
  if (override === 'openai-compatible') return 'openai-compatible';
  try {
    const hostname = new URL(String(baseUrl || '').trim()).hostname.toLowerCase();
    return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com') ? 'anthropic' : 'openai-compatible';
  } catch {
    return 'openai-compatible';
  }
}

export function friendlyError(error, fallback = '操作没有完成，请检查后重试') {
  const code = String(error?.code || '');
  if (code === 'MODEL_CONNECTION_FAILED' && /HTTP\s+\d{3}/i.test(String(error?.message || ''))) return String(error.message);
  const messages = {
    UNSUPPORTED_SOURCE_URL: '这个地址不是受支持的公开 GitHub 仓库，请检查后重试',
    GITHUB_REF_NOT_FOUND: '没有找到指定的分支、标签或 Commit，请检查高级设置',
    SOURCE_UNREADABLE: '无法读取这个项目文件夹，请检查路径和访问权限',
    SOURCE_NOT_DIRECTORY: '请选择一个项目文件夹，而不是单个文件',
    SOURCE_FILE_TOO_LARGE: '项目中存在超出评测限制的大文件，请移除后重试',
    SOURCE_TOTAL_TOO_LARGE: '项目体积超出评测限制，请精简后重试',
    RUNTIME_NETWORK_NOT_AUTHORIZED: '请允许本次评测访问模型公网，否则无法连接模型服务',
    MODEL_CONFIGURATION_INVALID: '模型配置不完整，请检查 Base URL、API Key 和模型名',
    MODEL_CONNECTION_FAILED: '模型服务连接失败，请检查 Base URL、API Key 和模型名后重试',
  };
  return messages[code] || String(error?.message || fallback).replace(/^[A-Z0-9_]+:\s*/, '') || fallback;
}
