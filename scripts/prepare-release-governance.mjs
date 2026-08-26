import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { auditProfessionalDataset } from '../src/dataset/audit.mjs';
import { auditFailureCorpus } from '../src/dataset/failure-audit.mjs';
import { buildProtocolManifest, evaluateReleaseEvidence, generateReviewPacket, validateSignoffs } from '../src/dataset/governance.mjs';

const root = path.resolve(import.meta.dirname, '..');
const corpusRoot = path.join(root, 'datasets', 'real-failures');
const datasetRoot = path.join(root, 'datasets', 'real-failure-pilot');
const output = path.resolve(process.argv[2] || path.join(root, '.moss-eval', 'governance', 'current'));
const corpus = (await auditFailureCorpus(corpusRoot)).report;
const dataset = (await auditProfessionalDataset(datasetRoot)).report;
const calibrationFile = path.join(root, '.moss-eval', 'datasets', `${dataset.dataset.id}-${dataset.dataset.version}`, 'calibration', 'calibration.json');
const calibration = JSON.parse(await fsp.readFile(calibrationFile, 'utf8'));
const packet = await generateReviewPacket({ corpusReport: corpus, datasetReport: dataset, calibrationReport: calibration, output: path.join(output, 'review') });
const caseReviewRoot = path.join(output, 'review', 'cases');
await fsp.mkdir(caseReviewRoot, { recursive: true });
for (const item of corpus.cases.filter((entry) => entry.accepted)) {
  const caseRoot = path.join(corpusRoot, 'cases', item.case_id);
  const record = JSON.parse(await fsp.readFile(path.join(caseRoot, 'case.json'), 'utf8'));
  const reproduction = JSON.parse(await fsp.readFile(path.join(caseRoot, 'reproduction.json'), 'utf8'));
  const receipt = JSON.parse(await fsp.readFile(path.join(caseRoot, 'reproduction-receipt.json'), 'utf8'));
  const minimization = JSON.parse(await fsp.readFile(path.join(caseRoot, 'minimization.json'), 'utf8'));
  const caseCalibration = JSON.parse(await fsp.readFile(path.join(caseRoot, 'calibration.json'), 'utf8'));
  const review = { schema_version: '1.0', case_id: item.case_id, case_sha256: item.case_sha256, source: { locator: record.source.canonical_locator, failure_revision: reproduction.target.failure_revision, fixed_revision: reproduction.target.fixed_revision, assertions: reproduction.source_assertions }, reproduction: { command: `node bin/moss-eval.mjs failure-reproduce --corpus datasets/real-failures --case ${item.case_id} --authorize --source <MOSS_CHECKOUT>`, status: receipt.status, source_validation: receipt.source_validation }, minimization, calibration: { gate: caseCalibration.gate, control_count: caseCalibration.control_count, controls: caseCalibration.controls.map((control) => ({ id: control.control_id, kind: control.kind, correct: control.correct, reasons: control.reason_codes })) }, reviewer_checklist: ['source diff supports the claimed independent mechanism', 'failure and fixed observations are distinct', 'minimized fixture does not change the construct', 'wrong-answer controls cover plausible bypasses', 'privacy and license classification is correct'] };
  await fsp.writeFile(path.join(caseReviewRoot, `${item.case_id}.json`), JSON.stringify(review, null, 2) + '\n', 'utf8');
  await fsp.writeFile(path.join(caseReviewRoot, `${item.case_id}.md`), `# ${record.title}\n\n- Case: \`${item.case_id}\`\n- Source: ${record.source.canonical_locator}\n- Failure revision: \`${reproduction.target.failure_revision}\`\n- Fixed revision: \`${reproduction.target.fixed_revision}\`\n- Reproduction: **${receipt.status}**\n- Calibration: **${caseCalibration.gate}** (${caseCalibration.control_count} controls)\n\n## Claim\n\n${record.observed_failure}\n\n## Expected behavior\n\n${record.expected_behavior}\n\n## Reproduce\n\n\`${review.reproduction.command}\`\n\n## Human checklist\n\n${review.reviewer_checklist.map((value) => `- [ ] ${value}`).join('\n')}\n`, 'utf8');
}
const protocol = buildProtocolManifest({ dataset_digest: dataset.content_digest, tasks: dataset.tasks.map((item) => item.task_id).sort(), trials: 3, budgets: { max_tool_calls: 30, max_model_calls: 24, max_execution_seconds: 240, max_cost_usd: 2 }, timeout_seconds: 240, concurrency: 2, network: 'model-only', environment: { os: 'linux-container', cpu: 2, memory_mb: 4096, host_platform: `${os.platform()}-${os.arch()}` }, adapters: [{ family: 'moss', id: 'moss-source' }, { family: 'claude-code', id: 'command' }, { family: 'codex', id: 'command' }], created_at: '2026-08-26T00:00:00.000Z' });
const signoffFile = path.join(output, 'signoffs.json');
const signoffs = JSON.parse(await fsp.readFile(signoffFile, 'utf8').catch(() => '{"records":[]}')).records || [];
const trustedKeyFile = process.env.MOSS_EVAL_REVIEW_KEYS_FILE;
const trustedKeys = trustedKeyFile ? JSON.parse(await fsp.readFile(path.resolve(trustedKeyFile), 'utf8')) : {};
const signoffStatus = validateSignoffs({ artifactDigest: packet.artifact_digest, signoffs, trustedKeys });
const decision = evaluateReleaseEvidence({ corpus, calibration, source_reproduction: { verified: corpus.counts.reproduced, total: corpus.counts.accepted }, adapters: [], cross_agent: null, hidden_oracle: null, signoffs: signoffStatus, telemetry: null, security: { secret_scan_passed: corpus.secret_findings.length === 0 && dataset.dataset_secret_findings.length === 0, oracle_isolation_passed: false }, regression: null, packaged_client: null });
await fsp.mkdir(output, { recursive: true });
await fsp.writeFile(path.join(output, 'protocol.json'), JSON.stringify(protocol, null, 2) + '\n', 'utf8');
await fsp.writeFile(path.join(output, 'release-decision.json'), JSON.stringify(decision, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ output, review_packet: packet, protocol, release_decision: decision }, null, 2) + '\n');
