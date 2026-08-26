import fsp from 'node:fs/promises';
import path from 'node:path';

import { loadProfessionalDataset } from '../src/dataset/contract.mjs';
import { loadFailureCorpus, validateCalibrationEvidence } from '../src/dataset/failure-contract.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const corpusRoot = path.resolve(process.argv[2] || path.join(repositoryRoot, 'datasets', 'real-failures'));
const datasetRoot = path.resolve(process.argv[3] || path.join(repositoryRoot, 'datasets', 'real-failure-pilot'));
const corpus = await loadFailureCorpus(corpusRoot);
const dataset = await loadProfessionalDataset(datasetRoot);
const calibrationFile = path.resolve(process.argv[4] || path.join(repositoryRoot, '.moss-eval', 'datasets', `${dataset.manifest.id}-${dataset.manifest.version}`, 'calibration', 'calibration.json'));
const calibration = JSON.parse(await fsp.readFile(calibrationFile, 'utf8'));
if (calibration.gate !== 'pass') throw new Error('Calibration evidence is not passing');
if (calibration.dataset.id !== dataset.manifest.id || calibration.dataset.version !== dataset.manifest.version) throw new Error('Calibration dataset identity mismatch');

const cardsByCase = new Map(dataset.cards.map((card) => [card.source_case_id, card]));
const resultsByTask = new Map(calibration.tasks.map((task) => [task.task_id, task]));
const written = [];
for (const record of corpus.cases.filter((item) => item.task_mapping?.calibration_path)) {
  const mapping = record._meta.taskMapping?.value;
  const card = cardsByCase.get(record.id);
  const result = resultsByTask.get(mapping?.task_id);
  if (!mapping || !card || card.id !== mapping.task_id || card.track !== mapping.track || !result) throw new Error(`Incomplete promotion chain for ${record.id}`);
  const evidence = validateCalibrationEvidence({
    schema_version: '1.0',
    case_id: record.id,
    task_id: result.task_id,
    dataset: calibration.dataset,
    dataset_digest: calibration.dataset_digest,
    gate: result.gate,
    control_count: result.controls.length,
    positive_false_negatives: result.positive_false_negatives,
    negative_false_positives: result.negative_false_positives,
    execution_errors: result.execution_errors,
    isolated_workspaces: result.isolated_workspaces,
    controls: result.controls.map((control) => ({
      control_id: control.control_id,
      kind: control.kind,
      expected_pass: control.expected_pass,
      actual_pass: control.actual_pass,
      correct: control.correct,
      execution_status: control.execution_status,
      oracle_mutated_workspace: control.oracle_mutated_workspace,
      reason_codes: control.reason_codes || [],
    })),
  }, record, mapping);
  const target = path.resolve(record._meta.directory, record.task_mapping.calibration_path);
  await fsp.writeFile(target, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  written.push(path.relative(corpusRoot, target).split(path.sep).join('/'));
}

process.stdout.write(JSON.stringify({ gate: 'pass', written_count: written.length, written }, null, 2) + '\n');
