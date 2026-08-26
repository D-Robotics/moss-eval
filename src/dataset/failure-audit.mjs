import fsp from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, directoryManifest, fileDigest, sha256 } from './canonical.mjs';
import { deriveFailureCaseState, loadFailureCorpus } from './failure-contract.mjs';

const SECRET_PATTERNS = [
  /(?:^|[^A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function increment(record, key) { if (key) record[key] = (record[key] || 0) + 1; }

async function secretFindings(root) {
  const findings = [];
  for (const item of await directoryManifest(root)) {
    if (item.size > 1024 * 1024) continue;
    const text = await fsp.readFile(path.join(root, ...item.path.split('/')), 'utf8').catch(() => '');
    if (SECRET_PATTERNS.some((expression) => expression.test(text))) findings.push(item.path);
  }
  return findings.sort();
}

export async function auditFailureCorpus(root) {
  const corpus = await loadFailureCorpus(root);
  const rejectionFile = path.join(corpus.root, 'rejected-cases.json');
  const rejectionLedger = JSON.parse(await fsp.readFile(rejectionFile, 'utf8').catch(() => '{"records":[]}'));
  const explicitRejections = Array.isArray(rejectionLedger.records) ? rejectionLedger.records : [];
  const evidenceGroups = new Map();
  for (const item of corpus.cases) {
    if (!evidenceGroups.has(item._meta.evidenceIdentity)) evidenceGroups.set(item._meta.evidenceIdentity, []);
    evidenceGroups.get(item._meta.evidenceIdentity).push(item.id);
  }
  const exactDuplicates = [...evidenceGroups.entries()].filter(([, ids]) => ids.length > 1).map(([evidence_identity, case_ids]) => ({ evidence_identity, case_ids: case_ids.sort() }));
  const duplicateIds = new Set(exactDuplicates.flatMap((item) => item.case_ids.slice(1)));
  const cases = [];
  const coverage = { strata: {}, categories: {}, constructs: {}, severities: {}, source_projects: {}, source_changes: {}, source_revisions: {}, root_cause_families: {}, states: {} };
  for (const item of corpus.cases) {
    const artifacts = {
      reproduction: item._meta.reproductionReceipt?.value,
      minimization: item._meta.minimizationReceipt?.value,
      calibration: item._meta.calibration?.value,
      pilot: item._meta.pilot?.value,
    };
    const derived = deriveFailureCaseState(item, artifacts);
    const blockers = [...derived.blockers];
    const relativeCase = path.relative(corpus.root, item._meta.file).split(path.sep).join('/');
    const actualCaseDigest = await fileDigest(item._meta.file);
    if (corpus.manifest.case_digests[relativeCase] !== actualCaseDigest) blockers.push('case-digest-mismatch');
    if (duplicateIds.has(item.id)) blockers.push('exact-evidence-duplicate');
    if (item.source.kind === 'authorized-incident' && item.source.privacy_classification === 'public') blockers.push('private-source-privacy-invalid');
    const accepted = derived.accepted && !duplicateIds.has(item.id) && blockers.every((value) => !['private-source-privacy-invalid'].includes(value));
    increment(coverage.strata, item.stratum);
    increment(coverage.categories, item.category);
    increment(coverage.constructs, item.construct.primary);
    increment(coverage.severities, item.severity || 'unspecified');
    increment(coverage.source_projects, item.source_project);
    increment(coverage.source_changes, item.source.canonical_locator);
    increment(coverage.source_revisions, item.evidence[0]?.revision || 'unspecified');
    increment(coverage.root_cause_families, item.root_cause_family);
    increment(coverage.states, derived.state);
    cases.push({
      case_id: item.id,
      version: item.version,
      stratum: item.stratum,
      state: derived.state,
      accepted,
      severity: item.severity || 'unspecified',
      source_change: item.source.canonical_locator,
      source_revision: item.evidence[0]?.revision || null,
      task_id: item.task_mapping?.task_id || null,
      blockers: [...new Set(blockers)].sort(),
      case_sha256: actualCaseDigest,
      evidence_identity: item._meta.evidenceIdentity,
    });
  }
  const secrets = await secretFindings(corpus.root);
  const declared = new Set(['registry.json', ...(corpus.manifest.supplemental_files || []), ...corpus.manifest.cases]);
  const declaredPrefixes = [];
  for (const item of corpus.cases) {
    const prefix = path.relative(corpus.root, item._meta.directory).split(path.sep).join('/');
    for (const relative of [item.reproduction?.definition_path, item.reproduction?.receipt_path, item.minimization?.receipt_path, item.task_mapping?.mapping_path, item.task_mapping?.calibration_path, item.pilot?.evidence_path].filter(Boolean)) {
      declared.add(`${prefix}/${relative}`);
    }
    if (item._meta.reproductionDefinition?.value?.fixture?.path) declaredPrefixes.push(`${prefix}/${item._meta.reproductionDefinition.value.fixture.path.replace(/\/$/, '')}/`);
  }
  const undeclared = (await directoryManifest(corpus.root)).map((item) => item.path).filter((item) => !declared.has(item) && !declaredPrefixes.some((prefix) => item.startsWith(prefix)));
  const counts = {
    raw_candidates: cases.length + explicitRejections.length,
    discovered: cases.length,
    accepted: cases.filter((item) => item.accepted).length,
    rejected: cases.filter((item) => item.state === 'rejected').length + explicitRejections.length,
    reproduced: cases.filter((item) => ['reproduced', 'minimized', 'task-ready', 'calibrated', 'reviewed', 'piloted', 'release-eligible'].includes(item.state)).length,
    task_ready: cases.filter((item) => ['task-ready', 'calibrated', 'reviewed', 'piloted', 'release-eligible'].includes(item.state)).length,
    release_eligible: cases.filter((item) => item.state === 'release-eligible').length,
  };
  const technicalBlockers = [...secrets.map((file) => `possible-secret:${file}`), ...undeclared.map((file) => `undeclared-file:${file}`)];
  if (cases.some((item) => item.blockers.includes('case-digest-mismatch'))) technicalBlockers.push('case-content-drift');
  const acceptedCases = cases.filter((item) => item.accepted);
  const taskIds = acceptedCases.map((item) => item.task_id).filter(Boolean);
  if (taskIds.length !== acceptedCases.length || new Set(taskIds).size !== taskIds.length) technicalBlockers.push('accepted-case-task-mapping-not-one-to-one');
  const maxShare = (record) => acceptedCases.length ? Math.max(0, ...Object.values(record)) / acceptedCases.length : 1;
  const sourceChangeConcentration = maxShare(Object.fromEntries(Object.entries(coverage.source_changes).filter(([locator]) => acceptedCases.some((item) => item.source_change === locator)).map(([locator]) => [locator, acceptedCases.filter((item) => item.source_change === locator).length])));
  const constructConcentration = maxShare(Object.fromEntries(Object.entries(coverage.constructs).filter(([construct]) => acceptedCases.some((item) => item.case_id && corpus.cases.find((record) => record.id === item.case_id)?.construct.primary === construct)).map(([construct]) => [construct, corpus.cases.filter((record) => record.triage.decision === 'accepted' && record.construct.primary === construct).length])));
  const sourceLimit = corpus.manifest.policy.maximum_source_change_concentration ?? 1;
  const constructLimit = corpus.manifest.policy.maximum_construct_concentration ?? 1;
  const coverageBlockers = [];
  if (sourceChangeConcentration > sourceLimit) coverageBlockers.push('source-change-concentration-exceeded');
  if (constructConcentration > constructLimit) coverageBlockers.push('construct-concentration-exceeded');
  const content = { manifest: corpus.manifest, cases: cases.map(({ case_sha256, evidence_identity }) => ({ case_sha256, evidence_identity })) };
  const report = {
    schema_version: '1.0',
    corpus: { id: corpus.manifest.id, version: corpus.manifest.version },
    corpus_digest: sha256(canonicalJson(content)),
    technical_gate: technicalBlockers.length ? 'fail' : 'pass',
    counts,
    target: { minimum: corpus.manifest.policy.accepted_case_target_minimum, maximum: corpus.manifest.policy.accepted_case_target_maximum, achieved: counts.accepted >= corpus.manifest.policy.accepted_case_target_minimum },
    coverage_gate: coverageBlockers.length ? 'fail' : 'pass',
    concentration: { source_change: { observed: sourceChangeConcentration, maximum: sourceLimit }, construct: { observed: constructConcentration, maximum: constructLimit }, blockers: coverageBlockers },
    secret_findings: secrets,
    undeclared_files: undeclared,
    exact_duplicates: exactDuplicates,
    explicit_rejections: explicitRejections.map((item) => ({ candidate_id: item.candidate_id, decision: item.decision, reason_codes: item.reason_codes })),
    coverage,
    cases,
    blockers: technicalBlockers.sort(),
  };
  return { corpus, report };
}

function markdown(report) {
  return [
    '# Real Agent failure corpus audit', '',
    `- Corpus: ${report.corpus.id}@${report.corpus.version}`,
    `- Digest: ${report.corpus_digest}`,
    `- Technical gate: **${report.technical_gate.toUpperCase()}**`,
    `- Raw candidates / accepted / rejected / reproduced / task-ready: ${report.counts.raw_candidates} / ${report.counts.accepted} / ${report.counts.rejected} / ${report.counts.reproduced} / ${report.counts.task_ready}`,
    `- 20-case milestone achieved: **${report.target.achieved ? 'YES' : 'NO'}**`, '',
    '| Case | Stratum | State | Counted | Blockers |', '|---|---|---|---:|---|',
    ...report.cases.map((item) => `| ${item.case_id} | ${item.stratum} | ${item.state} | ${item.accepted ? 'yes' : 'no'} | ${item.blockers.join(', ') || '-'} |`), '',
    '> Candidate count is not an accepted, reproduced, task-ready, or Professional score.', '',
  ].join('\n');
}

export async function writeFailureAuditReport(report, output) {
  await fsp.mkdir(output, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(output, 'audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'),
    fsp.writeFile(path.join(output, 'audit.md'), markdown(report), 'utf8'),
  ]);
  return output;
}
