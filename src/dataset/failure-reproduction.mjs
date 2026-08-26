import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson, directoryDigest, fileDigest, sha256 } from './canonical.mjs';
import { loadFailureCorpus, validateMinimizationReceipt, validateTaskMapping } from './failure-contract.mjs';
import { runProcess } from '../lib/process.mjs';

function boundedPattern(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new Error(`${field} must contain 1-512 characters`);
  return new RegExp(value, 'm');
}

function safeEnvironment() {
  const allowed = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'LANG', 'LC_ALL'];
  return Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}

function interpolate(value, phase) { return String(value).replaceAll('{phase}', phase); }

async function git(sourceCheckout, args) {
  const result = await runProcess({ command: 'git', args: ['-C', sourceCheckout, ...args], cwd: sourceCheckout, env: safeEnvironment(), timeoutMs: 30000, outputLimit: 1024 * 1024 });
  if (result.startError || result.timedOut || result.outputTruncated || result.exitCode !== 0) throw Object.assign(new Error(`Git source verification failed: git ${args.join(' ')}`), { code: 'SOURCE_REVISION_VERIFICATION_FAILED' });
  return String(result.stdout || '').trim();
}

async function verifySourceRevisions(definition, sourceCheckout) {
  if (!definition.source_assertions?.length) return { status: 'not-required', assertions: [] };
  if (!sourceCheckout) return { status: 'not-run', reason: 'source-checkout-not-provided', assertions: [] };
  const checkout = path.resolve(sourceCheckout);
  const before = await git(checkout, ['status', '--porcelain=v1']);
  const revisions = {};
  for (const phase of ['failure', 'fixed']) {
    const revision = definition.target[`${phase}_revision`];
    revisions[phase] = await git(checkout, ['rev-parse', '--verify', `${revision}^{commit}`]);
    if (revisions[phase] !== revision) throw Object.assign(new Error(`${phase} revision did not resolve exactly`), { code: 'SOURCE_REVISION_MISMATCH' });
  }
  const assertions = [];
  for (const assertion of definition.source_assertions) {
    const failureBlob = await git(checkout, ['rev-parse', `${definition.target.failure_revision}:${assertion.path}`]);
    const fixedBlob = await git(checkout, ['rev-parse', `${definition.target.fixed_revision}:${assertion.path}`]);
    const matched = failureBlob === assertion.failure_blob && fixedBlob === assertion.fixed_blob && failureBlob !== fixedBlob;
    assertions.push({ path: assertion.path, failure_blob: failureBlob, fixed_blob: fixedBlob, matched });
    if (!matched) throw Object.assign(new Error(`Source object assertion failed: ${assertion.path}`), { code: 'SOURCE_OBJECT_MISMATCH' });
  }
  const after = await git(checkout, ['status', '--porcelain=v1']);
  if (after !== before) throw Object.assign(new Error('Source verification mutated the source checkout'), { code: 'SOURCE_CHECKOUT_MUTATED' });
  return { status: 'verified', repository: definition.target.repository, checkout, source_checkout_unchanged: true, revisions, assertions };
}

async function executePhase(definition, phase, workspace, options) {
  const step = definition.steps[phase];
  const [rawCommand, ...rawArgs] = step.command;
  const command = rawCommand === 'node' ? process.execPath : interpolate(rawCommand, phase);
  const args = rawArgs.map((item) => interpolate(item, phase));
  const result = await (options.processRunner || runProcess)({
    command,
    args,
    cwd: workspace,
    env: { ...safeEnvironment(), MOSS_FAILURE_CASE_ID: definition.case_id, MOSS_FAILURE_PHASE: phase },
    timeoutMs: definition.environment.timeout_seconds * 1000,
    outputLimit: definition.environment.output_limit_bytes || 1024 * 1024,
  });
  const stdoutPattern = step.expect.stdout_matches ? boundedPattern(step.expect.stdout_matches, `${phase}.stdout_matches`) : null;
  const stderrPattern = step.expect.stderr_matches ? boundedPattern(step.expect.stderr_matches, `${phase}.stderr_matches`) : null;
  const matched = !result.startError && !result.timedOut && !result.outputTruncated
    && step.expect.exit_codes.includes(result.exitCode)
    && (!stdoutPattern || stdoutPattern.test(result.stdout || ''))
    && (!stderrPattern || stderrPattern.test(result.stderr || ''));
  return {
    matched,
    exit_code: result.exitCode,
    timed_out: result.timedOut,
    output_truncated: result.outputTruncated,
    start_error: result.startError?.code || null,
    duration_ms: result.durationMs,
    stdout_tail: String(result.stdout || '').slice(-4096),
    stderr_tail: String(result.stderr || '').slice(-4096),
  };
}

export async function reproduceFailureCase(corpusRoot, caseId, options = {}) {
  if (options.authorized !== true) throw Object.assign(new Error('Failure reproduction requires explicit authorization'), { code: 'REPRODUCTION_NOT_AUTHORIZED' });
  const corpus = await loadFailureCorpus(corpusRoot);
  const record = corpus.cases.find((item) => item.id === caseId);
  if (!record) throw new Error(`Unknown failure case: ${caseId}`);
  if (record.triage.decision !== 'accepted') throw Object.assign(new Error(`Case ${caseId} has not passed triage`), { code: 'REPRODUCTION_NOT_ELIGIBLE' });
  const definitionArtifact = record._meta.reproductionDefinition;
  if (!definitionArtifact) throw new Error(`Case ${caseId} has no reproduction definition`);
  const definition = definitionArtifact.value;
  if (definition.environment.runner !== 'node') throw new Error(`Unsupported reproduction runner: ${definition.environment.runner}`);
  if (definition.environment.network !== 'disabled') throw new Error('Node reproduction runner only supports network=disabled declarations');
  const fixture = path.resolve(record._meta.directory, definition.fixture.path);
  const actualFixtureDigest = await directoryDigest(fixture);
  if (actualFixtureDigest !== definition.fixture.sha256) throw Object.assign(new Error('Reproduction fixture digest mismatch'), { code: 'REPRODUCTION_FIXTURE_DRIFT' });
  const fixtureBefore = actualFixtureDigest;
  const started = Date.now();
  const sourceValidation = await verifySourceRevisions(definition, options.sourceCheckout);
  const phases = {};
  for (const phase of ['failure', 'fixed']) {
    const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), `moss-repro-${caseId}-${phase}-`));
    const workspace = path.join(temporary, 'workspace');
    try {
      await fsp.cp(fixture, workspace, { recursive: true, force: true });
      phases[phase] = await executePhase(definition, phase, workspace, options);
      phases[phase].workspace_digest = await directoryDigest(workspace);
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  }
  const fixtureAfter = await directoryDigest(fixture);
  if (fixtureAfter !== fixtureBefore) throw Object.assign(new Error('Reproduction mutated the source fixture'), { code: 'REPRODUCTION_SOURCE_MUTATED' });
  const status = phases.failure.matched && phases.fixed.matched ? 'reproduced' : 'not-reproduced';
  const receipt = {
    schema_version: '1.0',
    case_id: caseId,
    status,
    definition_sha256: await fileDigest(definitionArtifact.file),
    fixture_sha256: actualFixtureDigest,
    environment_fingerprint: sha256(canonicalJson({ runner: 'node', network: 'disabled', node: process.version, platform: process.platform, architecture: process.arch })),
    target: definition.target,
    reproduction_scope: 'source-derived-minimized-fixture',
    source_validation: sourceValidation,
    executed_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    source_fixture_unchanged: fixtureAfter === fixtureBefore,
    phases,
  };
  if (options.writeReceipt) {
    if (definition.source_assertions?.length && sourceValidation.status !== 'verified') throw Object.assign(new Error('Writing retained reproduction evidence requires --source with the pinned Git objects'), { code: 'SOURCE_REVISION_NOT_VERIFIED' });
    if (!record.reproduction.receipt_path) throw new Error('Case has no reproduction receipt path');
    await fsp.writeFile(path.resolve(record._meta.directory, record.reproduction.receipt_path), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  }
  return receipt;
}

export function createMinimizationReceipt(record, reproductionReceipt, input = {}) {
  const preserved = reproductionReceipt.status === 'reproduced'
    && reproductionReceipt.phases?.failure?.matched === true
    && reproductionReceipt.phases?.fixed?.matched === true
    && input.original_signature === input.minimized_signature;
  return validateMinimizationReceipt({
    schema_version: '1.0', case_id: record.id, status: preserved ? 'preserved' : 'not-preserved',
    original_signature: input.original_signature, minimized_signature: input.minimized_signature,
    rationale: input.rationale, fixture_sha256: reproductionReceipt.fixture_sha256,
  }, record);
}

export function createTaskMapping(record, options = {}) {
  if (record._meta.reproductionReceipt?.value?.status !== 'reproduced') throw new Error('Task promotion requires a reproduced case');
  if (record._meta.minimizationReceipt?.value?.status !== 'preserved') throw new Error('Task promotion requires preserved minimization');
  const track = record.stratum === 'agent-harness' ? 'harness-regression'
    : record.source.kind === 'authorized-incident' ? 'private-business' : 'target-regression';
  return validateTaskMapping({
    schema_version: '1.0', case_id: record.id, task_id: options.taskId || `real-${record.id.slice(3)}`,
    track, source_evidence_digest: record._meta.evidenceIdentity,
    public_development: true, hidden_oracle_digest: null,
  }, record);
}
