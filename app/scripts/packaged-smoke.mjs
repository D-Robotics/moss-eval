import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const resources=path.resolve(process.argv[2]||path.join(import.meta.dirname,'../../app/dist/win-unpacked/resources'));
const project=path.join(resources,'project');
await fsp.access(path.join(project,'src/core/evaluation-service.mjs'));
await fsp.access(path.join(project,'schemas/task.schema.json'));
const { resolveStoragePaths, ensureStoragePaths }=await import(pathToFileURL(path.join(project,'src/core/storage-paths.mjs')).href);
const { loadRunArtifacts }=await import(pathToFileURL(path.join(project,'src/core/artifacts.mjs')).href);
const userData=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-packaged-smoke-'));
try{const paths=await ensureStoragePaths(resolveStoragePaths({userDataRoot:userData,packaged:true,resourcesPath:resources}));assert.equal(paths.projectRoot,project);await fsp.writeFile(path.join(paths.config,'probe'),'ok');assert.equal(await fsp.readFile(path.join(paths.config,'probe'),'utf8'),'ok');const run=path.join(paths.runs,'smoke-run');const trialDir=path.join(run,'trials/task/agent/trial-1');await fsp.mkdir(trialDir,{recursive:true});await fsp.writeFile(path.join(run,'run.json'),JSON.stringify({schema_version:'1.0',run_id:'smoke-run',status:'completed'}));await fsp.writeFile(path.join(run,'summary.json'),JSON.stringify({schema_version:'1.0'}));await fsp.writeFile(path.join(trialDir,'trial.json'),JSON.stringify({schema_version:'1.0',task:{id:'task'},agent:'agent',replicate:1}));assert.equal((await loadRunArtifacts(run)).trials.length,1);}finally{await fsp.rm(userData,{recursive:true,force:true});}
process.stdout.write('packaged smoke passed\n');
