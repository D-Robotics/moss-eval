import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { resolveStoragePaths } from '../../src/core/storage-paths.mjs';

const root=path.resolve(import.meta.dirname,'../..');

test('packaged paths use resources/project and never the development checkout',()=>{
  const paths=resolveStoragePaths({userDataRoot:'C:/Users/test/AppData/Roaming/MossEval',packaged:true,resourcesPath:'C:/Program Files/MOSS Eval/resources'});
  assert.match(paths.projectRoot,/Program Files[\\/]MOSS Eval[\\/]resources[\\/]project$/);
  assert.notEqual(paths.root,paths.projectRoot);
});

test('Windows packages are reproducibly configured with provenance, NSIS and portable targets',async()=>{
  const pkg=JSON.parse(await fsp.readFile(path.join(root,'app/package.json'),'utf8'));
  const lock=JSON.parse(await fsp.readFile(path.join(root,'app/package-lock.json'),'utf8'));
  assert.equal(pkg.devDependencies.electron,lock.packages['node_modules/electron'].version);
  assert.equal(pkg.devDependencies['electron-builder'],lock.packages['node_modules/electron-builder'].version);
  assert.deepEqual(pkg.build.win.target.map(target=>target.target),['nsis','portable']);
  assert.ok(pkg.build.extraResources.some(resource=>resource.to==='build-provenance.json'));
  assert.match(pkg.scripts['dist:win'],/write-checksums/);
});

test('generated artifacts, dependencies, settings and credentials are excluded from version control',async()=>{
  const ignore=await fsp.readFile(path.join(root,'.gitignore'),'utf8');
  for(const pattern of ['app/node_modules/','app/dist/','app/build-provenance.json','credentials.json','settings.json'])assert.ok(ignore.includes(pattern));
});
