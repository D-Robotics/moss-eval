export const CAPABILITY_SCHEMA_VERSION = '1.0';
export const TELEMETRY_LEVEL_ORDER = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 });

export function normalizeTaskRequirements(task) {
  const declared = task.capability_requirements || {};
  return {
    schema_version: CAPABILITY_SCHEMA_VERSION,
    modes: [...new Set(declared.modes || [task.mode])],
    min_telemetry_level: declared.min_telemetry_level || 'L0',
    required_tools: [...new Set(declared.required_tools || [])],
    required_any_tools: [...new Set(declared.required_any_tools || [])],
    required_tags: [...new Set(declared.required_tags || [])],
    runners: [...new Set(declared.runners || [task.environment?.runner].filter(Boolean))],
    sandbox_features: [...new Set(declared.sandbox_features || [])],
  };
}

export function normalizeTargetCapabilities(capabilities = {}) {
  return {
    schema_version: CAPABILITY_SCHEMA_VERSION,
    modes: [...new Set(capabilities.modes || [])],
    telemetry_level: capabilities.telemetry_level || 'L0',
    tools: [...new Set(capabilities.tools || [])],
    tags: [...new Set(capabilities.tags || [])],
    runners: [...new Set(capabilities.runners || ['docker'])],
    sandbox_features: [...new Set(capabilities.sandbox_features || [])],
  };
}

export function telemetryAtLeast(actual, required) {
  return Number.isInteger(TELEMETRY_LEVEL_ORDER[actual]) &&
    Number.isInteger(TELEMETRY_LEVEL_ORDER[required]) &&
    TELEMETRY_LEVEL_ORDER[actual] >= TELEMETRY_LEVEL_ORDER[required];
}

export function evaluateTaskEligibility(task, targetCapabilities) {
  const requirements = normalizeTaskRequirements(task);
  const capabilities = normalizeTargetCapabilities(targetCapabilities);
  const missing = [];
  if (!requirements.modes.some((mode) => capabilities.modes.includes(mode))) {
    missing.push({ type: 'mode', required: requirements.modes, available: capabilities.modes });
  }
  if (!telemetryAtLeast(capabilities.telemetry_level, requirements.min_telemetry_level)) {
    missing.push({
      type: 'telemetry_level', required: requirements.min_telemetry_level,
      available: capabilities.telemetry_level,
    });
  }
  const missingTools = requirements.required_tools.filter((tool) => !capabilities.tools.includes(tool));
  if (missingTools.length > 0) missing.push({ type: 'required_tools', required: missingTools, available: capabilities.tools });
  if (
    requirements.required_any_tools.length > 0 &&
    !requirements.required_any_tools.some((tool) => capabilities.tools.includes(tool))
  ) {
    missing.push({ type: 'required_any_tools', required: requirements.required_any_tools, available: capabilities.tools });
  }
  const missingTags = requirements.required_tags.filter((tag) => !capabilities.tags.includes(tag));
  if (missingTags.length > 0) missing.push({ type: 'required_tags', required: missingTags, available: capabilities.tags });
  if (requirements.runners.length > 0 && !requirements.runners.some((runner) => capabilities.runners.includes(runner))) {
    missing.push({ type: 'runner', required: requirements.runners, available: capabilities.runners });
  }
  const missingSandbox = requirements.sandbox_features.filter(
    (feature) => !capabilities.sandbox_features.includes(feature),
  );
  if (missingSandbox.length > 0) {
    missing.push({ type: 'sandbox_features', required: missingSandbox, available: capabilities.sandbox_features });
  }
  return {
    schema_version: CAPABILITY_SCHEMA_VERSION,
    task_id: task.id,
    status: missing.length === 0 ? 'eligible' : 'NOT_APPLICABLE',
    eligible: missing.length === 0,
    requirements,
    capabilities,
    missing,
  };
}

export function achievedTelemetryLevel(traceSummary, mode = null) {
  const structuredModes = new Set(['stream-json', 'pty', 'acp']);
  let level = 'L0';
  if (
    structuredModes.has(mode) ||
    traceSummary.native_telemetry?.available ||
    (traceSummary.tool_calls || []).length > 0
  ) level = 'L1';
  if (
    Number.isFinite(traceSummary.usage?.total_tokens) ||
    Number.isFinite(traceSummary.model_call_count) ||
    Number.isFinite(traceSummary.cost_usd)
  ) level = 'L2';
  if (
    traceSummary.native_telemetry?.available ||
    (traceSummary.retries || 0) > 0 ||
    (traceSummary.context_compactions || 0) > 0 ||
    (traceSummary.subagent_spawns || 0) > 0
  ) level = 'L3';
  return level;
}
