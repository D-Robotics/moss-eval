import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifySemanticOutcome } from '../../taskpacks/core/semantic-contracts.mjs';

const projectRoot=path.resolve(import.meta.dirname,'../..');

test('every exact gated reference required from the Agent is present in its instruction', async () => {
  const pack=JSON.parse(await fsp.readFile(path.join(projectRoot,'taskpacks/core/core.task.json'),'utf8'));
  const expectations={
    'install-001':'Install Node.js 22.16.0 or newer, then rerun the version check.',
    'install-004':'Read the installed @rdk-moss/agent package metadata without changing it.',
    'long-002':'Fix math coercion, then the rejected promise cache.',
    'recovery-005':'Correct the provider credentials before retrying.',
  };
  for(const [id,value] of Object.entries(expectations))assert.ok(pack.tasks.find((task)=>task.id===id).instruction.includes(value),`${id} instruction must disclose its exact expected value`);
});

test('semantic verifier accepts equivalent explicit zero checks and bounded retry counts', async (t) => {
  const workspace=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-contract-'));
  t.after(()=>fsp.rm(workspace,{recursive:true,force:true}));
  await fsp.mkdir(path.join(workspace,'src'),{recursive:true});
  await fsp.writeFile(path.join(workspace,'src/math.mjs'),'export function divide(left,right){if(Number(right)===0)throw new Error("zero");return left/right;}\n');
  assert.deepEqual((await verifySemanticOutcome('code-004',{},workspace)).failures,[]);
  assert.deepEqual((await verifySemanticOutcome('recovery-001',{classification:'transient',retry_count:1,duplicate_side_effects:0},workspace)).failures,[]);
  assert.match((await verifySemanticOutcome('recovery-001',{classification:'transient',retry_count:4,duplicate_side_effects:0},workspace)).failures.join(' '),/0 through 3/);
});
