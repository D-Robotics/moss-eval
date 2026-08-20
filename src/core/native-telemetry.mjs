import fsp from 'node:fs/promises';
import path from 'node:path';
import { redactObject } from '../lib/json.mjs';

const DEFAULT_FIELD_LIMIT = 4096;
const STRUCTURED_TRACE_MODES = new Set(['stream-json', 'acp']);
const DEFAULT_MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'apply_patch',
  'move_file',
]);
const DEFAULT_VERIFICATION_TOOLS = new Set(['run_tests', 'verify_fix']);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function bounded(value, secrets, limit) {
  if (value === undefined) return null;
  const redacted = redactObject(value, secrets);
  const serialized = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  if (serialized.length <= limit) return redacted;
  return {
    truncated: true,
    original_chars: serialized.length,
    preview: serialized.slice(0, limit) + '[TRUNCATED]',
  };
}

async function listJsonl(directory) {
  try {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJsonLines(file) {
  const text = await fsp.readFile(file, 'utf8');
  const records = [];
  let invalidLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }
  return { records, invalidLines };
}

function messagesFromRecord(record) {
  const messages = [];
  if (Array.isArray(record?.messages)) messages.push(...record.messages);
  if (record?.message && typeof record.message === 'object') messages.push(record.message);
  if (record?.data?.message && typeof record.data.message === 'object') {
    messages.push(record.data.message);
  }
  if (record?.payload?.message && typeof record.payload.message === 'object') {
    messages.push(record.payload.message);
  }
  return messages;
}

function blocksFromMessage(message) {
  return Array.isArray(message?.content) ? message.content : [];
}

function toolCallId(block, fallbackIndex) {
  return String(
    firstPresent(block?.id, block?.tool_use_id, block?.toolUseId, block?.toolCallId, block?.call_id) ??
      `native-call-${fallbackIndex}`,
  );
}

function toolName(block, fallback = 'unknown') {
  return String(firstPresent(block?.name, block?.tool, block?.tool_name, block?.toolName) ?? fallback);
}

function mergeCall(toolCalls, incoming, conflicts) {
  const existing = toolCalls.get(incoming.call_id);
  if (!existing) {
    toolCalls.set(incoming.call_id, incoming);
    return;
  }
  if (
    existing.tool !== 'unknown' &&
    incoming.tool !== 'unknown' &&
    existing.tool !== incoming.tool
  ) {
    conflicts.push({
      type: 'tool_name_conflict',
      call_id: incoming.call_id,
      values: [existing.tool, incoming.tool],
    });
  }
  toolCalls.set(incoming.call_id, {
    ...existing,
    ...Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== null && value !== undefined),
    ),
    tool: existing.tool === 'unknown' ? incoming.tool : existing.tool,
    arguments: existing.arguments ?? incoming.arguments,
  });
}

async function collectSessions(workspace, options) {
  const directory = path.join(workspace, '.moss', 'sessions');
  const files = await listJsonl(directory);
  const toolCalls = new Map();
  const conflicts = [];
  let parsedLines = 0;
  let invalidLines = 0;
  let blockIndex = 0;

  for (const file of files) {
    const parsed = await readJsonLines(file);
    parsedLines += parsed.records.length;
    invalidLines += parsed.invalidLines;
    for (const record of parsed.records) {
      for (const message of messagesFromRecord(record)) {
        for (const block of blocksFromMessage(message)) {
          blockIndex += 1;
          if (block?.type === 'tool_use') {
            const callId = toolCallId(block, blockIndex);
            mergeCall(
              toolCalls,
              {
                call_id: callId,
                tool: toolName(block),
                arguments: bounded(
                  firstPresent(block.input, block.arguments, {}),
                  options.secrets,
                  options.fieldLimit,
                ),
                status: 'requested',
                result_summary: null,
                outcome: null,
                duration_ms: null,
                aborted: null,
                error: null,
              },
              conflicts,
            );
          }
          if (block?.type === 'tool_result') {
            const callId = toolCallId(block, blockIndex);
            const existing = toolCalls.get(callId);
            const isError = Boolean(firstPresent(block.is_error, block.isError, false));
            mergeCall(
              toolCalls,
              {
                call_id: callId,
                tool: toolName(block, existing?.tool || 'unknown'),
                arguments: existing?.arguments ?? null,
                status: isError ? 'error' : 'success',
                result_summary: bounded(
                  firstPresent(block.content, block.result, block.output, ''),
                  options.secrets,
                  options.fieldLimit,
                ),
                outcome: firstPresent(block.outcome, null),
                duration_ms: finiteNumber(firstPresent(block.durationMs, block.duration_ms)),
                aborted: bounded(firstPresent(block.aborted, null), options.secrets, options.fieldLimit),
                error: bounded(firstPresent(block.error, null), options.secrets, options.fieldLimit),
              },
              conflicts,
            );
          }
        }
      }
    }
  }

  const calls = [...toolCalls.values()];
  return {
    available: files.length > 0,
    files: files.map((file) => path.relative(workspace, file).split(path.sep).join('/')),
    parsed_lines: parsedLines,
    invalid_lines: invalidLines,
    tool_call_count: calls.length,
    tool_result_count: calls.filter((call) => call.status !== 'requested').length,
    tool_error_count: calls.filter((call) => call.status === 'error').length,
    conflicts,
    tool_calls: calls,
  };
}

function normalizeUsageRecord(record, secrets, limit) {
  const inputTokens = finiteNumber(firstPresent(record.inputTokens, record.input_tokens));
  const outputTokens = finiteNumber(firstPresent(record.outputTokens, record.output_tokens));
  if (inputTokens === null || outputTokens === null) return null;
  return {
    run_id: firstPresent(record.runId, record.run_id, null),
    provider: firstPresent(record.providerId, record.provider_id, record.provider, null),
    model: firstPresent(record.model, null),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens:
      finiteNumber(firstPresent(record.cacheReadTokens, record.cache_read_tokens)) ?? 0,
    cache_creation_tokens:
      finiteNumber(firstPresent(record.cacheCreationTokens, record.cache_creation_tokens)) ?? 0,
    duration_ms: finiteNumber(firstPresent(record.durationMs, record.duration_ms)),
    success: record.success !== false,
    error: bounded(firstPresent(record.error, null), secrets, limit),
    timestamp: firstPresent(record.timestamp, null),
  };
}

async function collectUsage(workspace, options) {
  const file = path.join(workspace, '.moss', 'llm-usage.jsonl');
  let parsed;
  try {
    parsed = await readJsonLines(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        available: false,
        file: null,
        parsed_lines: 0,
        invalid_lines: 0,
        invalid_records: 0,
        records: [],
        model_call_count: null,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
      };
    }
    throw error;
  }

  const records = [];
  let invalidRecords = 0;
  for (const record of parsed.records) {
    const normalized = normalizeUsageRecord(record, options.secrets, options.fieldLimit);
    if (normalized) records.push(normalized);
    else invalidRecords += 1;
  }
  const sum = (field) => records.reduce((total, record) => total + (record[field] || 0), 0);
  const inputTokens = sum('input_tokens');
  const outputTokens = sum('output_tokens');
  return {
    available: true,
    file: path.relative(workspace, file).split(path.sep).join('/'),
    parsed_lines: parsed.records.length,
    invalid_lines: parsed.invalidLines,
    invalid_records: invalidRecords,
    records,
    model_call_count: records.length,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cache_read_tokens: sum('cache_read_tokens'),
    cache_creation_tokens: sum('cache_creation_tokens'),
  };
}

export async function collectMossNativeTelemetry(workspace, options = {}) {
  const normalizedOptions = {
    secrets: options.secrets || [],
    fieldLimit: options.fieldLimit || DEFAULT_FIELD_LIMIT,
  };
  const [session, usage] = await Promise.all([
    collectSessions(workspace, normalizedOptions),
    collectUsage(workspace, normalizedOptions),
  ]);
  return {
    schema_version: '1.0',
    source: 'moss-native',
    available: session.available || usage.available,
    session,
    usage,
  };
}

export function unavailableNativeTelemetry(source = 'adapter-none') {
  return {
    schema_version: '1.0',
    source,
    available: false,
    session: {
      available: false,
      files: [],
      parsed_lines: 0,
      invalid_lines: 0,
      tool_call_count: 0,
      tool_result_count: 0,
      tool_error_count: 0,
      conflicts: [],
      tool_calls: [],
    },
    usage: {
      available: false,
      file: null,
      parsed_lines: 0,
      invalid_lines: 0,
      invalid_records: 0,
      records: [],
      model_call_count: null,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
    },
  };
}

function sortedIds(calls) {
  return [...new Set((calls || []).map((call) => call.call_id).filter(Boolean))].sort();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function reconcileNativeTelemetry(traceSummary, nativeTelemetry, options = {}) {
  const mismatches = [];
  const session = nativeTelemetry.session;
  const usage = nativeTelemetry.usage;
  const streamCalls = traceSummary.tool_calls || [];
  const compareStructuredTools = STRUCTURED_TRACE_MODES.has(options.mode) && session.available;

  if (session.invalid_lines > 0) {
    mismatches.push({
      type: 'session_parse_errors',
      invalid_lines: session.invalid_lines,
    });
  }
  if (session.conflicts.length > 0) {
    mismatches.push({ type: 'session_conflicts', count: session.conflicts.length });
  }
  if (usage.invalid_lines > 0 || usage.invalid_records > 0) {
    mismatches.push({
      type: 'usage_parse_errors',
      invalid_lines: usage.invalid_lines,
      invalid_records: usage.invalid_records,
    });
  }
  if (compareStructuredTools && streamCalls.length !== session.tool_call_count) {
    mismatches.push({
      type: 'stream_session_tool_count',
      stream: streamCalls.length,
      session: session.tool_call_count,
    });
  }
  if (compareStructuredTools) {
    const streamIds = sortedIds(streamCalls);
    const sessionIds = sortedIds(session.tool_calls);
    if (!sameArray(streamIds, sessionIds)) {
      mismatches.push({ type: 'stream_session_call_ids', stream: streamIds, session: sessionIds });
    }
  }
  const streamTokens = finiteNumber(traceSummary.usage?.total_tokens);
  if (usage.available && streamTokens !== null && streamTokens !== usage.total_tokens) {
    mismatches.push({
      type: 'stream_usage_token_total',
      stream: streamTokens,
      native: usage.total_tokens,
    });
  }

  return {
    available: nativeTelemetry.available,
    valid: nativeTelemetry.available ? mismatches.length === 0 : null,
    trusted_tool_source: session.available ? 'session-jsonl' : 'stream',
    trusted_usage_source: usage.available ? 'llm-usage-jsonl' : 'stream',
    sources: {
      stream_tool_calls: streamCalls.length,
      session_tool_calls: session.available ? session.tool_call_count : null,
      stream_total_tokens: streamTokens,
      native_total_tokens: usage.available ? usage.total_tokens : null,
    },
    mismatches,
  };
}

export function mergeTraceWithNative(traceSummary, nativeTelemetry, reconciliation) {
  const session = nativeTelemetry.session;
  const usage = nativeTelemetry.usage;
  const toolCalls = session.available ? session.tool_calls : traceSummary.tool_calls || [];
  const mergedUsage = usage.available
    ? {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cache_creation_tokens: usage.cache_creation_tokens,
      }
    : traceSummary.usage;
  return {
    ...traceSummary,
    tool_calls: toolCalls,
    tool_call_count: toolCalls.length,
    usage: mergedUsage,
    model_call_count: usage.available
      ? usage.model_call_count
      : traceSummary.event_counts?.llm_usage || traceSummary.event_counts?.assistant_message || null,
    native_telemetry: nativeTelemetry,
    telemetry: reconciliation,
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function scoreToolExpectations(toolCalls, expectations) {
  if (!expectations) {
    return {
      eligible: false,
      precision: null,
      recall: null,
      f1: null,
      policy_passed: null,
      violations: [],
    };
  }
  const observedSequence = (toolCalls || []).map((call) => call.tool);
  const observed = new Set(observedSequence);
  const requiredAny = expectations.required_any || [];
  const requiredAll = expectations.required_all || [];
  const expected = new Set(expectations.expected || [...requiredAny, ...requiredAll]);
  const truePositives = [...observed].filter((tool) => expected.has(tool)).length;
  const precision = ratio(truePositives, observed.size);
  const recall = ratio(truePositives, expected.size);
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : precision === 0 || recall === 0
        ? 0
        : null;
  const violations = [];
  const formatValid = (toolCalls || []).filter((call) =>
    typeof call?.tool === 'string' && call.tool.length > 0 && call.tool !== 'unknown' &&
    call.arguments !== null && typeof call.arguments === 'object' && !Array.isArray(call.arguments),
  ).length;
  const argumentChecks = [];
  for (const call of toolCalls || []) {
    const requiredFields = expectations.argument_requirements?.[call.tool];
    if (!requiredFields) continue;
    const missing = requiredFields.filter((field) => call.arguments?.[field] === undefined);
    argumentChecks.push({ call_id: call.call_id, tool: call.tool, missing, passed: missing.length === 0 });
    if (missing.length) violations.push({ type: 'missing_tool_arguments', call_id: call.call_id, tool: call.tool, fields: missing });
  }
  if (requiredAny.length > 0 && !requiredAny.some((tool) => observed.has(tool))) {
    violations.push({ type: 'missing_required_any', tools: requiredAny });
  }
  const missingAll = requiredAll.filter((tool) => !observed.has(tool));
  if (missingAll.length > 0) violations.push({ type: 'missing_required_all', tools: missingAll });
  const forbidden = (expectations.forbidden || []).filter((tool) => observed.has(tool));
  if (forbidden.length > 0) violations.push({ type: 'forbidden_tools', tools: forbidden });
  if (Number.isFinite(expectations.max_calls) && observedSequence.length > expectations.max_calls) {
    violations.push({
      type: 'max_calls_exceeded',
      actual: observedSequence.length,
      limit: expectations.max_calls,
    });
  }
  if (expectations.must_verify_after_mutation) {
    const mutationTools = new Set(expectations.mutation_tools || DEFAULT_MUTATION_TOOLS);
    const verificationTools = new Set(expectations.verification_tools || DEFAULT_VERIFICATION_TOOLS);
    const lastMutation = observedSequence.reduce(
      (last, tool, index) => (mutationTools.has(tool) ? index : last),
      -1,
    );
    const verifiedAfter = observedSequence.some(
      (tool, index) => index > lastMutation && verificationTools.has(tool),
    );
    if (lastMutation >= 0 && !verifiedAfter) {
      violations.push({ type: 'missing_verification_after_mutation' });
    }
  }
  const expectedOrder = expectations.expected_order || [];
  let orderPassed = null;
  if (expectedOrder.length) {
    let cursor = -1;
    orderPassed = expectedOrder.every((tool) => {
      cursor = observedSequence.indexOf(tool, cursor + 1);
      return cursor >= 0;
    });
    if (!orderPassed) violations.push({ type: 'expected_order_not_observed', expected_order: expectedOrder });
  }
  const signatures = observedSequence.map((tool, index) => tool + '|' + JSON.stringify(toolCalls[index]?.arguments || {}));
  const redundantCalls = signatures.length - new Set(signatures).size;
  return {
    eligible: true,
    expected_tools: [...expected],
    observed_tools: [...observed],
    precision,
    recall,
    f1,
    format_accuracy: ratio(formatValid, (toolCalls || []).length),
    argument_accuracy: ratio(argumentChecks.filter((item) => item.passed).length, argumentChecks.length),
    argument_checks: argumentChecks,
    order_passed: orderPassed,
    redundant_call_count: redundantCalls,
    efficiency: (toolCalls || []).length ? Math.max(0, 1 - redundantCalls / toolCalls.length) : 1,
    policy_passed: violations.length === 0,
    violations,
  };
}

export function summarizeNativeTelemetry(nativeTelemetry, reconciliation) {
  const durations = nativeTelemetry.session.tool_calls
    .map((call) => call.duration_ms)
    .filter(Number.isFinite);
  return {
    schema_version: nativeTelemetry.schema_version,
    available: nativeTelemetry.available,
    session: {
      available: nativeTelemetry.session.available,
      file_count: nativeTelemetry.session.files.length,
      parsed_lines: nativeTelemetry.session.parsed_lines,
      invalid_lines: nativeTelemetry.session.invalid_lines,
      tool_call_count: nativeTelemetry.session.tool_call_count,
      tool_result_count: nativeTelemetry.session.tool_result_count,
      tool_error_count: nativeTelemetry.session.tool_error_count,
      duration_record_count: durations.length,
      total_tool_duration_ms: durations.reduce((sum, duration) => sum + duration, 0),
    },
    usage: {
      available: nativeTelemetry.usage.available,
      model_call_count: nativeTelemetry.usage.model_call_count,
      input_tokens: nativeTelemetry.usage.input_tokens,
      output_tokens: nativeTelemetry.usage.output_tokens,
      total_tokens: nativeTelemetry.usage.total_tokens,
      cache_read_tokens: nativeTelemetry.usage.cache_read_tokens,
      cache_creation_tokens: nativeTelemetry.usage.cache_creation_tokens,
    },
    reconciliation,
  };
}
