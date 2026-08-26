import { digestArtifact } from './governance.mjs';

export function qualifyAdapterFromRun(input) {
  const reasons = [];
  if (!input?.agent_family || !input?.adapter_id || !input?.adapter_version) reasons.push('adapter-identity-missing');
  if (!input?.protocol_digest || !/^[a-f0-9]{64}$/.test(input.protocol_digest)) reasons.push('protocol-identity-missing');
  if (!Array.isArray(input?.trials) || input.trials.length === 0) reasons.push('qualification-trials-missing');
  for (const trial of input?.trials || []) {
    if (trial.instruction_delivered !== true) reasons.push('instruction-delivery-not-proven');
    if (trial.workspace_isolated !== true) reasons.push('workspace-isolation-not-proven');
    if (trial.receipt_present !== true) reasons.push('final-state-mutation-not-proven');
    if (trial.exit_handled !== true) reasons.push('exit-handling-not-proven');
    if (trial.transcript_captured !== true) reasons.push('transcript-capture-not-proven');
    if (trial.timeout_enforced !== true) reasons.push('timeout-enforcement-not-proven');
    if (trial.secret_cleanup !== true) reasons.push('secret-cleanup-not-proven');
  }
  const unsigned = { schema_version: '1.0', agent_family: input?.agent_family || null, adapter_id: input?.adapter_id || null, adapter_version: input?.adapter_version || null, protocol_digest: input?.protocol_digest || null, qualified: reasons.length === 0, classification: reasons.length ? 'infrastructure-invalid' : 'qualified', reasons: [...new Set(reasons)].sort(), trial_count: input?.trials?.length || 0 };
  return { ...unsigned, qualification_digest: digestArtifact(unsigned) };
}

export function aggregateComparableRuns({ protocol, qualifications = [], runs = [] }) {
  const qualified = new Map(qualifications.filter((item) => item.qualified && item.protocol_digest === protocol.protocol_digest).map((item) => [item.agent_family, item]));
  const compatible = runs.filter((run) => run.protocol_digest === protocol.protocol_digest && qualified.has(run.agent_family));
  const excluded = runs.filter((run) => !compatible.includes(run)).map((run) => ({ agent_family: run.agent_family, reason: run.protocol_digest !== protocol.protocol_digest ? 'protocol-digest-mismatch' : 'adapter-not-qualified' }));
  const families = new Set(compatible.map((run) => run.agent_family));
  const comparable = families.size >= 3;
  const unsigned = { schema_version: '1.0', protocol_digest: protocol.protocol_digest, comparable, agent_families: families.size, included: compatible.map((run) => ({ agent_family: run.agent_family, run_id: run.run_id, summary_digest: run.summary_digest, metrics: run.metrics })), excluded, blockers: comparable ? [] : ['insufficient-qualified-agent-families'] };
  return { ...unsigned, comparison_digest: digestArtifact(unsigned) };
}

