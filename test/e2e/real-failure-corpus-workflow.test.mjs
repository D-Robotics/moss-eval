import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { auditProfessionalDataset } from '../../src/dataset/audit.mjs';
import { calibrateProfessionalDataset } from '../../src/dataset/calibration.mjs';
import { auditFailureCorpus } from '../../src/dataset/failure-audit.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '../..');
const corpusRoot = path.join(projectRoot, 'datasets', 'real-failures');
const datasetRoot = path.join(projectRoot, 'datasets', 'real-failure-pilot');

test('candidate-to-calibrated-task workflow is linked, auditable, and fail closed', async (t) => {
  const output = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-failure-e2e-'));
  t.after(() => fsp.rm(output, { recursive: true, force: true }));
  const cli = path.join(projectRoot, 'bin', 'moss-eval.mjs');

  const auditCommand = await execute(process.execPath, [cli, 'failure-audit', '--corpus', corpusRoot, '--output', output], { cwd: projectRoot });
  const cliAudit = JSON.parse(auditCommand.stdout);
  assert.equal(cliAudit.technical_gate, 'pass');
  assert.ok(cliAudit.counts.accepted >= 20);
  assert.equal(cliAudit.counts.rejected, 3);

  await assert.rejects(
    execute(process.execPath, [cli, 'failure-reproduce', '--corpus', corpusRoot, '--case', 'rf-moss-compaction-history-drop'], { cwd: projectRoot }),
    (error) => {
      const result = JSON.parse(error.stderr);
      assert.equal(result.error.code, 'REPRODUCTION_NOT_AUTHORIZED');
      return true;
    },
  );

  const reproduction = JSON.parse((await execute(process.execPath, [cli, 'failure-reproduce', '--corpus', corpusRoot, '--case', 'rf-moss-compaction-history-drop', '--authorize'], { cwd: projectRoot })).stdout);
  assert.equal(reproduction.status, 'reproduced');
  const mapping = JSON.parse((await execute(process.execPath, [cli, 'failure-promote', '--corpus', corpusRoot, '--case', 'rf-moss-compaction-history-drop'], { cwd: projectRoot })).stdout);
  assert.equal(mapping.task_id, 'real-moss-compaction-history-drop');

  const professional = await auditProfessionalDataset(datasetRoot);
  const calibrated = await calibrateProfessionalDataset(datasetRoot);
  const corpus = await auditFailureCorpus(corpusRoot);
  assert.equal(professional.report.technical_gate, 'pass');
  assert.equal(calibrated.report.gate, 'pass');
  assert.equal(calibrated.report.control_count, calibrated.report.task_count * 6);
  assert.equal(corpus.report.counts.task_ready, cliAudit.counts.accepted);
  assert.ok(corpus.report.cases.filter((item) => item.accepted).every((item) => item.state === 'calibrated'));
  const taskIds = new Set(professional.dataset.cards.map((card) => card.id));
  for (const record of corpus.corpus.cases.filter((item) => item.triage.decision === 'accepted')) assert.ok(taskIds.has(record._meta.taskMapping.value.task_id));
});
