#!/usr/bin/env node
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { auditHiddenMaterialIsolation, runHiddenOracleBundle } from '../src/dataset/hidden-release.mjs';

const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-hidden-release-contract-'));
try {
  const privateRoot = path.join(temp, 'private');
  const publicRoot = path.join(temp, 'public');
  const workspace = path.join(publicRoot, 'trial-workspace');
  await fsp.mkdir(path.join(privateRoot, 'cases', 'synthetic'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'results'), { recursive: true });
  await fsp.writeFile(path.join(privateRoot, 'bundle.json'), JSON.stringify({ schema_version: '1.0', cases: [{ task_id: 'real-synthetic-hidden-contract', oracle: 'cases/synthetic/verify.mjs' }] }, null, 2) + '\n');
  await fsp.writeFile(path.join(privateRoot, 'cases', 'synthetic', 'verify.mjs'), "import fsp from 'node:fs/promises';import path from 'node:path';const [root,id]=process.argv.slice(2);const value=JSON.parse(await fsp.readFile(path.join(root,'results',id+'.json'),'utf8'));process.stdout.write(JSON.stringify({decision:value.answer===42?'pass':'fail',reasons:value.answer===42?[]:['answer-mismatch']})+'\\n');\n");
  await fsp.writeFile(path.join(workspace, 'results', 'real-synthetic-hidden-contract.json'), JSON.stringify({ answer: 42 }) + '\n');

  const receipt = await runHiddenOracleBundle({
    bundleRoot: privateRoot,
    salt: 'synthetic-ci-only-salt-value',
    trials: [{ task_id: 'real-synthetic-hidden-contract', workspace }],
  });
  const isolation = await auditHiddenMaterialIsolation({ publicRoots: [publicRoot], privateBundleRoot: privateRoot, forbiddenValues: ['synthetic-ci-only-salt-value'] });
  if (!receipt.run_passed || !receipt.execution_valid || !isolation.pass) throw new Error('Synthetic hidden-release contract did not pass');
  const serialized = JSON.stringify(receipt);
  if (serialized.includes(privateRoot) || serialized.includes('verify.mjs') || serialized.includes('synthetic-ci-only-salt-value')) throw new Error('Hidden receipt disclosed private material');
  process.stdout.write(JSON.stringify({ pass: true, fixture: 'synthetic-non-release', hidden_execution: receipt.run_passed, isolation_audit: isolation.pass, bundle_digest: receipt.bundle_digest }, null, 2) + '\n');
} finally {
  await fsp.rm(temp, { recursive: true, force: true });
}
