import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditHiddenMaterialIsolation, loadPrivateOracleBundle, runHiddenOracleBundle } from '../../src/dataset/hidden-release.mjs';

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-hidden-unit-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'private');
  const workspace = path.join(root, 'workspace');
  await fsp.mkdir(path.join(bundle, 'case'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'results'), { recursive: true });
  await fsp.writeFile(path.join(bundle, 'bundle.json'), JSON.stringify({ schema_version: '1.0', cases: [{ task_id: 'real-private-test', oracle: 'case/verify.mjs' }] }));
  await fsp.writeFile(path.join(bundle, 'case', 'verify.mjs'), "import fsp from 'node:fs/promises';import path from 'node:path';const [root,id]=process.argv.slice(2);const x=JSON.parse(await fsp.readFile(path.join(root,'results',id+'.json'),'utf8'));process.stdout.write(JSON.stringify({decision:x.ok?'pass':'fail',reasons:x.ok?[]:['not-ok']})+'\\n');");
  await fsp.writeFile(path.join(workspace, 'results', 'real-private-test.json'), JSON.stringify({ ok: true }));
  return { root, bundle, workspace };
}

test('hidden Oracle runs against a disposable workspace without disclosing private paths', async (t) => {
  const item = await fixture(t);
  const receipt = await runHiddenOracleBundle({ bundleRoot: item.bundle, salt: 'unit-test-hidden-salt', trials: [{ task_id: 'real-private-test', workspace: item.workspace }] });
  assert.equal(receipt.run_passed, true);
  assert.equal(receipt.execution_valid, true);
  assert.equal(JSON.stringify(receipt).includes(item.bundle), false);
  assert.equal(JSON.stringify(receipt).includes('verify.mjs'), false);
});

test('hidden bundle rejects traversal and missing task coverage', async (t) => {
  const item = await fixture(t);
  await fsp.writeFile(path.join(item.bundle, 'bundle.json'), JSON.stringify({ schema_version: '1.0', cases: [{ task_id: 'real-private-test', oracle: '../verify.mjs' }] }));
  await assert.rejects(loadPrivateOracleBundle(item.bundle, ['real-private-test']), /Invalid private Oracle bundle/);
});

test('isolation audit detects exact private content copied to a public surface', async (t) => {
  const item = await fixture(t);
  const leaked = path.join(item.root, 'public');
  await fsp.mkdir(leaked);
  await fsp.copyFile(path.join(item.bundle, 'case', 'verify.mjs'), path.join(leaked, 'copied.mjs'));
  const report = await auditHiddenMaterialIsolation({ publicRoots: [leaked], privateBundleRoot: item.bundle });
  assert.equal(report.pass, false);
  assert.equal(report.findings[0].reason, 'exact-hidden-content-match');
});
