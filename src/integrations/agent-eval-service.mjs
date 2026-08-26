import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadRunTrials } from '../core/aggregate.mjs';
import { writeJson } from '../lib/json.mjs';

async function loadTrajectory(file) {
  try {
    const lines = (await fsp.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function loadText(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

async function loadJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function toToolCalls(events) {
  return events
    .filter((event) => event.type === 'tool_call')
    .map((event) => ({
      name: event.data?.tool,
      args: event.data?.arguments || {},
      call_id: event.data?.call_id || null,
    }));
}

function toNativeToolCalls(nativeTelemetry) {
  if (!nativeTelemetry?.session?.available) return null;
  return nativeTelemetry.session.tool_calls.map((call) => ({
    name: call.tool,
    args: call.arguments || {},
    call_id: call.call_id,
    status: call.status,
    outcome: call.outcome,
    duration_ms: call.duration_ms,
  }));
}

function toConversation(events) {
  return events
    .filter((event) => ['assistant_message', 'tool_result', 'stdout', 'stderr'].includes(event.type))
    .map((event) => ({
      role: event.type === 'assistant_message' ? 'assistant' : 'tool',
      content:
        event.data?.text ||
        (typeof event.data?.result === 'string'
          ? event.data.result
          : JSON.stringify(event.data?.result || '')),
      call_id: event.data?.call_id || null,
    }));
}

export async function buildAgentEvalExport(runDirectory) {
  const trials = await loadRunTrials(runDirectory);
  const runMetadata = await loadJson(path.join(runDirectory, 'run.json'));
  const summary = await loadJson(path.join(runDirectory, 'summary.json'));
  const releaseDecision = await loadJson(path.join(runDirectory, 'release-decision.json'));
  const cases = [];
  for (const trial of trials) {
    const events = await loadTrajectory(trial.artifacts.trajectory);
    const candidateAnswer = await loadText(trial.artifacts.final_response);
    const nativeTelemetry = await loadJson(trial.artifacts.native_telemetry);
    const nativeToolCalls = toNativeToolCalls(nativeTelemetry);
    cases.push({
      case_id: trial.task.id + ':' + trial.agent + ':' + trial.replicate,
      question: trial.task.instruction,
      expected_answer: trial.task.expected_answer,
      candidate_answer: candidateAnswer,
      actual_tool_calls: nativeToolCalls || toToolCalls(events),
      expected_tool_calls: trial.task.expected_tool_calls,
      conversation_history: toConversation(events),
      metadata: {
        task_id: trial.task.id,
        task_version: trial.task.version,
        category: trial.task.category,
        priority: trial.task.priority,
        mode: trial.task.mode,
        agent: trial.agent,
        replicate: trial.replicate,
        outcome_passed: trial.outcome_passed,
        safety_passed: trial.safety_passed,
        success: trial.success,
        valid: trial.valid,
        failure_category: trial.failure_category,
        metrics: trial.metrics,
        graders: trial.graders,
        fingerprint: trial.fingerprint,
        artifacts: trial.artifacts,
      },
    });
  }
  const sourceRevisions = [...new Set(trials.map((trial) => trial.fingerprint?.source?.commit || trial.fingerprint?.moss_commit).filter(Boolean))];
  const adapters = [...new Map(trials.map((trial) => [
    `${trial.agent}:${trial.fingerprint?.adapter || 'unknown'}`,
    { agent: trial.agent, adapter_id: trial.fingerprint?.adapter || null, adapter_version: trial.fingerprint?.moss_version || null },
  ])).values()];
  const environments = [...new Map(trials.map((trial) => {
    const value = {
      runner: trial.fingerprint?.runner || null,
      image_digest: trial.fingerprint?.image_digest || null,
      node: trial.fingerprint?.node || null,
      platform: trial.fingerprint?.platform || null,
      architecture: trial.fingerprint?.architecture || null,
      resources: trial.fingerprint?.resources || null,
    };
    return [JSON.stringify(value), value];
  })).values()];
  const provenance = {
    source_revisions: sourceRevisions,
    dataset_digest: releaseDecision?.dataset_digest || null,
    protocol_digest: releaseDecision?.protocol_digest || null,
    adapters,
    environments,
    run_id: runMetadata?.run_id || null,
    run_artifact: path.resolve(runDirectory),
    release_decision_digest: releaseDecision?.decision_digest || null,
    summary_schema_version: summary?.schema_version || null,
  };
  const missing = Object.entries({
    source_revision: sourceRevisions.length === 1,
    dataset_digest: Boolean(provenance.dataset_digest),
    protocol_digest: Boolean(provenance.protocol_digest),
    adapter_identity: adapters.length > 0 && adapters.every((item) => item.adapter_id),
    environment_identity: environments.length > 0 && environments.every((item) => item.runner),
    run_identity: Boolean(provenance.run_id && provenance.run_artifact),
    release_decision: Boolean(provenance.release_decision_digest),
  }).filter(([, present]) => !present).map(([name]) => name);
  return {
    schema_version: 'moss-eval.agent-eval-service.v1',
    generated_at: new Date().toISOString(),
    source_run: path.resolve(runDirectory),
    claim_status: missing.length ? 'incomplete-provenance' : releaseDecision?.eligible ? 'release-eligible' : 'development-only',
    provenance_complete: missing.length === 0,
    provenance_missing: missing,
    provenance,
    release_decision: releaseDecision,
    cases,
  };
}

export async function exportAgentEval(runDirectory, outputFile = null) {
  const payload = await buildAgentEvalExport(runDirectory);
  const target = outputFile || path.join(runDirectory, 'agent-eval-service.json');
  await writeJson(target, payload);
  return { target, payload };
}

export async function publishAgentEval(payload, integration) {
  if (!integration?.url) throw new Error('agent_eval_service integration URL is not configured');
  const response = await fetch(integration.url, {
    method: integration.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(integration.headers || {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(integration.timeout_ms || 30000),
  });
  if (!response.ok) {
    throw new Error('agent_eval_service returned HTTP ' + response.status);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, body: text };
  }
}
