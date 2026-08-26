import fsp from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, directoryDigest, directoryManifest, fileDigest, sha256 } from './canonical.mjs';
import { deriveTaskState, loadProfessionalDataset } from './contract.mjs';
import { analyzePilot } from './pilot.mjs';

const SECRET_PATTERNS = [
  /(?:^|[^A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const values = selector(item);
    for (const value of Array.isArray(values) ? values : [values]) {
      if (!value) continue;
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

async function secretFindings(root) {
  const findings = [];
  for (const item of await directoryManifest(root)) {
    if (item.size > 1024 * 1024) continue;
    const file = path.join(root, ...item.path.split('/'));
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (SECRET_PATTERNS.some((expression) => expression.test(text))) findings.push(item.path);
  }
  return findings.sort();
}

function allowedFile(card, relative) {
  const prefixes = [card.fixture.path, ...card.controls.map((control) => control.path)]
    .map((item) => item.replaceAll('\\', '/').replace(/\/$/, '') + '/');
  const exact = new Set([
    'task-card.json',
    card.runtime_task.replaceAll('\\', '/'),
    card.oracle.path.replaceAll('\\', '/'),
    card.pilot.evidence_path.replaceAll('\\', '/'),
  ]);
  return exact.has(relative) || prefixes.some((prefix) => relative.startsWith(prefix));
}

async function auditCard(card, calibration, pilot, policy) {
  const blockers = [];
  const warnings = [];
  const actual = {
    runtime_task_sha256: await fileDigest(card._meta.runtimeTask),
    fixture_sha256: await directoryDigest(card._meta.fixture),
    oracle_sha256: await fileDigest(card._meta.oracle),
    pilot_sha256: await fileDigest(card._meta.pilot),
    controls: {},
    prompt_oracle_sha256: null,
  };
  const runtimeTask = JSON.parse(await fsp.readFile(card._meta.runtimeTask, 'utf8'));
  actual.prompt_oracle_sha256 = sha256(canonicalJson({
    instruction: runtimeTask.instruction,
    oracle_sha256: actual.oracle_sha256,
  }));
  if (actual.runtime_task_sha256 !== card.runtime_task_sha256) blockers.push('runtime-task-digest-mismatch');
  if (actual.fixture_sha256 !== card.fixture.sha256) blockers.push('fixture-digest-mismatch');
  if (actual.oracle_sha256 !== card.oracle.sha256) blockers.push('oracle-digest-mismatch');
  if (actual.pilot_sha256 !== card.pilot.sha256) blockers.push('pilot-evidence-digest-mismatch');
  for (const control of card.controls) {
    const digest = await directoryDigest(card._meta.controls[control.id]);
    actual.controls[control.id] = digest;
    if (digest !== control.sha256) blockers.push('control-digest-mismatch:' + control.id);
  }
  const files = await directoryManifest(card._meta.directory);
  for (const item of files) if (!allowedFile(card, item.path)) blockers.push('undeclared-file:' + item.path);
  const secrets = await secretFindings(card._meta.directory);
  blockers.push(...secrets.map((file) => 'possible-secret:' + file));
  if (card.oracle.distribution === 'public-development') warnings.push('public-development-oracle');
  if (card.contamination.status === 'public-development') warnings.push('public-development-contamination');
  const taskCalibration = calibration?.tasks?.find((item) => item.task_id === card.id) || null;
  const taskPilotRecords = pilot?.records?.filter((item) => item.task_id === card.id) || [];
  const pilotAnalysis = analyzePilot(taskPilotRecords, { ...policy, ...card.pilot.requirements });
  const state = deriveTaskState(card, {
    technical_passed: blockers.length === 0,
    calibration_passed: taskCalibration?.gate === 'pass',
    pilot_ready: pilotAnalysis.ready,
  }, policy);
  return {
    task_id: card.id,
    version: card.version,
    track: card.track,
    technical_gate: blockers.length ? 'fail' : 'pass',
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
    actual_digests: actual,
    state,
    pilot: pilotAnalysis,
  };
}

export async function auditProfessionalDataset(datasetRoot, options = {}) {
  const dataset = await loadProfessionalDataset(datasetRoot);
  const taskResults = [];
  for (const card of dataset.cards) {
    taskResults.push(await auditCard(card, options.calibration || null, options.pilot || null, dataset.manifest.policy));
  }
  const fixtureGroups = new Map();
  for (const result of taskResults) {
    const digest = result.actual_digests.fixture_sha256;
    if (!fixtureGroups.has(digest)) fixtureGroups.set(digest, []);
    fixtureGroups.get(digest).push(result.task_id);
  }
  const duplicateFixtures = [...fixtureGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([digest, ids]) => ({ digest, task_ids: ids.sort() }));
  const promptOracleGroups = new Map();
  for (const result of taskResults) {
    const digest = result.actual_digests.prompt_oracle_sha256;
    if (!promptOracleGroups.has(digest)) promptOracleGroups.set(digest, []);
    promptOracleGroups.get(digest).push(result.task_id);
  }
  const duplicatePromptOracles = [...promptOracleGroups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([digest, ids]) => ({ digest, task_ids: ids.sort() }));
  for (const duplicate of duplicateFixtures) {
    for (const id of duplicate.task_ids) {
      const result = taskResults.find((item) => item.task_id === id);
      result.blockers.push('duplicate-fixture:' + duplicate.task_ids.join(','));
      result.technical_gate = 'fail';
      result.state = deriveTaskState(dataset.cards.find((card) => card.id === id), {
        technical_passed: false,
        calibration_passed: false,
        pilot_ready: false,
      }, dataset.manifest.policy);
    }
  }
  for (const duplicate of duplicatePromptOracles) {
    for (const id of duplicate.task_ids) {
      const result = taskResults.find((item) => item.task_id === id);
      result.blockers.push('duplicate-prompt-oracle:' + duplicate.task_ids.join(','));
      result.technical_gate = 'fail';
      result.state = deriveTaskState(dataset.cards.find((card) => card.id === id), {
        technical_passed: false,
        calibration_passed: false,
        pilot_ready: false,
      }, dataset.manifest.policy);
    }
  }
  const primaryConstructs = countBy(dataset.cards, (card) => card.construct.primary);
  const maximumConstructCount = Math.max(0, ...Object.values(primaryConstructs));
  const maximumConstructConcentration = dataset.cards.length ? maximumConstructCount / dataset.cards.length : 0;
  const concentrationBlockers = maximumConstructConcentration > dataset.manifest.policy.maximum_construct_concentration
    ? ['maximum-construct-concentration-exceeded']
    : [];
  const secretFiles = await secretFindings(dataset.root);
  const content = {
    manifest: dataset.manifest,
    tasks: dataset.cards.map((card) => ({
      card: Object.fromEntries(Object.entries(card).filter(([key]) => key !== '_meta')),
      actual: taskResults.find((item) => item.task_id === card.id).actual_digests,
    })),
  };
  const technicalPassed = taskResults.every((item) => item.technical_gate === 'pass')
    && secretFiles.length === 0
    && concentrationBlockers.length === 0;
  const releaseEligible = technicalPassed && taskResults.every((item) => item.state.release_eligible);
  const report = {
    schema_version: '1.0',
    dataset: { id: dataset.manifest.id, version: dataset.manifest.version },
    content_digest: sha256(canonicalJson(content)),
    technical_gate: technicalPassed ? 'pass' : 'fail',
    professional_release_status: releaseEligible ? 'eligible' : 'not-established',
    release_eligible: releaseEligible,
    dataset_secret_findings: secretFiles,
    duplicate_fixtures: duplicateFixtures,
    duplicate_prompt_oracles: duplicatePromptOracles,
    concentration: {
      primary_constructs: primaryConstructs,
      maximum_observed: maximumConstructConcentration,
      maximum_allowed: dataset.manifest.policy.maximum_construct_concentration,
      gate: concentrationBlockers.length ? 'fail' : 'pass',
    },
    coverage: {
      task_count: dataset.cards.length,
      tracks: countBy(dataset.cards, (card) => card.track),
      categories: countBy(dataset.cards, (card) => card.category),
      constructs: countBy(dataset.cards, (card) => card.construct.tags),
      source_kinds: countBy(dataset.cards, (card) => card.source.kind),
      fixture_families: countBy(dataset.cards, (card) => card.fixture.family),
    },
    tasks: taskResults,
    blockers: [...new Set(taskResults.flatMap((item) => item.state.blockers).concat(
      concentrationBlockers,
      technicalPassed ? [] : ['technical-dataset-gate-failed'],
    ))].sort(),
  };
  return { dataset, report };
}

function auditMarkdown(report) {
  const rows = report.tasks.map((task) =>
    `| ${task.task_id} | ${task.technical_gate} | ${task.state.state} | ${task.state.blockers.join(', ') || '-'} |`,
  );
  return [
    '# Professional dataset audit',
    '',
    `- Dataset: ${report.dataset.id}@${report.dataset.version}`,
    `- Content digest: ${report.content_digest}`,
    `- Technical gate: **${report.technical_gate.toUpperCase()}**`,
    `- Professional release: **${report.professional_release_status.toUpperCase()}**`,
    '',
    '| Task | Technical | Evidence-derived state | Release blockers |',
    '|---|---:|---|---|',
    ...rows,
    '',
    '> A passing technical gate does not establish human review, hidden holdout validity, cross-Agent discrimination, or professional release eligibility.',
    '',
  ].join('\n');
}

export async function writeAuditReport(report, outputDirectory) {
  await fsp.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outputDirectory, 'audit.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'),
    fsp.writeFile(path.join(outputDirectory, 'audit.md'), auditMarkdown(report), 'utf8'),
  ]);
  return outputDirectory;
}
