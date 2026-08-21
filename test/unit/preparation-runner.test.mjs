import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAuthorizationRequest, grantAuthorization } from '../../src/core/authorization.mjs';
import { buildPreparedImage, renderPreparationDockerfile } from '../../src/core/preparation-runner.mjs';

test('preparation Dockerfile uses exec-form steps, non-root user and bounded target paths',()=>{
  const text=renderPreparationDockerfile({working_directory:'packages/agent',steps:[{command:'npm',args:['ci']}]},'sha256:'+'a'.repeat(64));
  assert.match(text,/FROM sha256:/);
  assert.match(text,/USER node/);
  assert.match(text,/RUN \["npm","ci"\]/);
  assert.throws(()=>renderPreparationDockerfile({working_directory:'../escape',steps:[]},'node:22'),/escapes target/);
  assert.throws(()=>renderPreparationDockerfile({working_directory:'.',steps:[{command:'npm\nRUN evil',args:[]}]},'node:22'),/Unsafe/);
});

test('prepared image build pins the base image and returns Docker actual digest',async()=>{
  const source=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-build-source-'));
  const calls=[];
  let renderedDockerfile='';
  const baseDigest='sha256:'+'b'.repeat(64),finalDigest='sha256:'+'c'.repeat(64);
  const processRunner=async(request)=>{calls.push(request);if(request.args[0]==='image'&&request.args.includes('node:22-bookworm'))return {exitCode:0,stdout:baseDigest+'\n',stderr:''};if(request.args[0]==='build'){renderedDockerfile=await fsp.readFile(request.args[request.args.indexOf('--file')+1],'utf8');return {exitCode:0,stdout:'built',stderr:''};}return {exitCode:0,stdout:finalDigest+'\n',stderr:''};};
  const auth=grantAuthorization(createAuthorizationRequest({operation:'prepare-target',network:{mode:'public'}}),{confirmed:true,approveNetwork:true});
  try{
    const dockerCommand=path.join(source,'docker-bin','docker.exe');
    const result=await buildPreparedImage({sourceRecord:{snapshot_fingerprint:'a'.repeat(64),snapshot_path:source},plan:{working_directory:'.',secret_names:['BUILD_TOKEN'],steps:[{command:'npm',args:['ci'],network:true}]},baseImage:'node:22-bookworm',sandboxPolicy:{cpu:1,memory_mb:1024,pids:64,disk_mb:2048,timeout_seconds:30},authorization:auth,secretValues:{BUILD_TOKEN:'never-in-args'}},{processRunner,dockerCommand,environment:{PATH:'C:\\Windows\\System32'}});
    assert.equal(result.base_image_digest,baseDigest);
    assert.equal(result.image_digest,finalDigest);
    const build=calls.find(call=>call.args[0]==='build');
    assert.ok(build.args.includes('default'));
    assert.ok(build.args.includes('--pull=false'));
    assert.ok(build.args.includes('1024m'));
    assert.ok(build.args.includes('id=BUILD_TOKEN,env=BUILD_TOKEN'));
    assert.doesNotMatch(build.args.join(' '),/never-in-args/);
    assert.equal(build.env.BUILD_TOKEN,'never-in-args');
    assert.equal(build.command,dockerCommand);
    assert.equal(build.env.PATH.split(path.delimiter)[0],path.dirname(dockerCommand));
    assert.ok(calls.every(call=>call.env.PATH.split(path.delimiter)[0]===path.dirname(dockerCommand)));
    assert.match(renderedDockerfile,new RegExp(`FROM moss-eval-base:${'b'.repeat(24)}`));
    assert.doesNotMatch(renderedDockerfile,/FROM sha256:/);
    const baseTag=calls.find(call=>call.args[0]==='image'&&call.args[1]==='tag');
    assert.deepEqual(baseTag.args,['image','tag',baseDigest,`moss-eval-base:${'b'.repeat(24)}`]);
    const dockerfile=await fsp.readFile(build.args[build.args.indexOf('--file')+1],'utf8').catch(()=>null);
    assert.equal(dockerfile,null,'temporary Dockerfile is removed after preparation');
  }finally{await fsp.rm(source,{recursive:true,force:true});}
});

test('networked preparation is blocked without explicit authorization',async()=>{
  await assert.rejects(buildPreparedImage({sourceRecord:{snapshot_fingerprint:'a'.repeat(64),snapshot_path:'C:/snapshot'},plan:{working_directory:'.',steps:[{command:'npm',args:['ci'],network:true}]},baseImage:'node:22',sandboxPolicy:{}},{processRunner:async()=>{throw new Error('must not execute');}}),error=>error.code==='NETWORK_AUTHORIZATION_REQUIRED');
});
