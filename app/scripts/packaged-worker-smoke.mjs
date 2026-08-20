import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const executable=path.resolve(process.argv[2]||'dist/win-unpacked/MOSS Eval.exe');
const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-worker-smoke-'));
const marker=path.join(directory,'handshake.txt');
try{
  const child=spawn(executable,[],{env:{...process.env,MOSS_EVAL_PACKAGED_SMOKE:'1',MOSS_EVAL_SMOKE_MARKER:marker},stdio:'ignore',windowsHide:true});
  const exitCode=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error('packaged worker smoke timed out'));},15000);child.once('error',reject);child.once('exit',(code)=>{clearTimeout(timeout);resolve(code);});});
  assert.equal(exitCode,0);
  assert.equal(await fsp.readFile(marker,'utf8'),'worker handshake passed\n');
  process.stdout.write('packaged worker handshake passed\n');
}finally{await fsp.rm(directory,{recursive:true,force:true});}
