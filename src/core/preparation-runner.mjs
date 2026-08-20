import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../lib/process.mjs';
import { createSandboxPolicy } from './sandbox-policy.mjs';

function safeBuildValue(value, label) {
  const text=String(value||'');
  if(!text||/[\r\n\0]/.test(text))throw new Error(`Unsafe ${label}`);
  return text;
}

function workDirectory(relative='.') {
  const normalized=path.posix.normalize('/target/'+String(relative).replaceAll('\\','/'));
  if(normalized!=='/target'&&!normalized.startsWith('/target/'))throw new Error('Preparation working directory escapes target');
  return normalized;
}

export function renderPreparationDockerfile(plan, baseImage='node:22-bookworm') {
  const lines=[
    '# syntax=docker/dockerfile:1.7',
    `FROM ${safeBuildValue(baseImage,'base image')}`,
    'COPY --chown=node:node . /target',
    `WORKDIR ${workDirectory(plan.working_directory)}`,
    'ENV PATH="/target/node_modules/.bin:${PATH}"',
    'USER node',
  ];
  const secretNames=plan.secret_names||[];
  for(const [index,step] of (plan.steps||[]).entries()){
    const command=safeBuildValue(step.command,`step ${index} command`);
    const args=(step.args||[]).map((arg)=>safeBuildValue(arg,`step ${index} argument`));
    const mounts=secretNames.map((name)=>`--mount=type=secret,id=${safeBuildValue(name,'secret name')},required=false`).join(' ');
    lines.push(`RUN ${mounts ? mounts+' ' : ''}${JSON.stringify([command,...args])}`);
  }
  lines.push('WORKDIR /workspace','ENTRYPOINT []','CMD ["node","--version"]','');
  return lines.join('\n');
}

export async function buildPreparedImage(input, options={}) {
  const processRunner=options.processRunner||runProcess;
  const dockerCommand=options.dockerCommand||'docker';
  const needsNetwork=(input.plan.steps||[]).some((step)=>step.network===true);
  const requestedNetwork=needsNetwork?'public':'disabled';
  const policy=createSandboxPolicy({...(input.sandboxPolicy||{}),network:requestedNetwork},input.authorization||null);
  if(needsNetwork&&!input.authorization?.network?.approved){const error=new Error('Preparation requires explicit build network authorization');error.code='PREPARATION_NETWORK_AUTHORIZATION_REQUIRED';throw error;}
  const temporary=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-eval-build-'));
  const dockerfile=path.join(temporary,'Dockerfile');
  const tag=`moss-eval-prepared:${crypto.createHash('sha256').update(input.sourceRecord.snapshot_fingerprint+JSON.stringify(input.plan)).digest('hex').slice(0,24)}`;
  const startedAt=new Date().toISOString();
  try{
    let baseInspect=await processRunner({command:dockerCommand,args:['image','inspect','--format','{{.Id}}',input.baseImage],cwd:temporary,timeoutMs:30000,signal:input.signal,outputLimit:10000});
    if(baseInspect.exitCode!==0){
      if(!input.authorization?.network?.approved){const error=new Error('Base image is unavailable locally and pulling it requires build network authorization');error.code='BASE_IMAGE_UNAVAILABLE';throw error;}
      const pulled=await processRunner({command:dockerCommand,args:['pull',input.baseImage],cwd:temporary,timeoutMs:policy.resources.timeout_seconds*1000,signal:input.signal,outputLimit:options.outputLimit||2_000_000});
      if(pulled.exitCode!==0){const error=new Error(`Unable to pull base image: ${pulled.stderr||pulled.stdout}`);error.code='BASE_IMAGE_PULL_FAILED';throw error;}
      baseInspect=await processRunner({command:dockerCommand,args:['image','inspect','--format','{{.Id}}',input.baseImage],cwd:temporary,timeoutMs:30000,signal:input.signal,outputLimit:10000});
    }
    const baseImageDigest=String(baseInspect.stdout||'').trim().toLowerCase();
    if(baseInspect.exitCode!==0||!/^sha256:[0-9a-f]{64}$/.test(baseImageDigest)){const error=new Error('Base image could not be pinned to an immutable digest');error.code='BASE_IMAGE_DIGEST_UNAVAILABLE';throw error;}
    await fsp.writeFile(dockerfile,renderPreparationDockerfile(input.plan,baseImageDigest),'utf8');
    options.onEvent?.({type:'preparation_build_started',data:{source_fingerprint:input.sourceRecord.snapshot_fingerprint,tag,policy}});
    const args=['build','--network',policy.network==='disabled'?'none':'default','--memory',`${policy.resources.memory_mb}m`,'--cpu-quota',String(Math.round(policy.resources.cpu*100000)),'--label','com.d-robotics.moss-eval.owner=true','--label',`com.d-robotics.moss-eval.source=${input.sourceRecord.snapshot_fingerprint}`];
    const childEnvironment={...process.env};
    for(const [name,value] of Object.entries(input.secretValues||{})){childEnvironment[name]=value;args.push('--secret',`id=${name},env=${name}`);}
    args.push('--file',dockerfile,'--tag',tag,input.sourceRecord.snapshot_path);
    const build=await processRunner({command:dockerCommand,args,cwd:temporary,env:childEnvironment,timeoutMs:policy.resources.timeout_seconds*1000,signal:input.signal,outputLimit:options.outputLimit||2_000_000});
    if(build.exitCode!==0){const error=new Error(`Prepared target build failed: ${build.stderr||build.stdout||build.startError?.message||'unknown Docker error'}`);error.code=build.timedOut?'PREPARATION_TIMEOUT':'PREPARATION_BUILD_FAILED';error.result=build;throw error;}
    const inspected=await processRunner({command:dockerCommand,args:['image','inspect','--format','{{.Id}}',tag],cwd:temporary,timeoutMs:30000,signal:input.signal,outputLimit:10000});
    const imageDigest=String(inspected.stdout||'').trim().toLowerCase();
    if(inspected.exitCode!==0||!/^sha256:[0-9a-f]{64}$/.test(imageDigest)){const error=new Error('Docker did not return an immutable image digest');error.code='PREPARED_IMAGE_DIGEST_UNAVAILABLE';throw error;}
    const result={schema_version:'1.0',started_at:startedAt,completed_at:new Date().toISOString(),image_digest:imageDigest,configured_base_image:input.baseImage,base_image_digest:baseImageDigest,tag,policy,command:{command:dockerCommand,args},logs:{stdout:build.stdout||'',stderr:build.stderr||''}};
    options.onEvent?.({type:'preparation_build_completed',data:{source_fingerprint:input.sourceRecord.snapshot_fingerprint,image_digest:imageDigest}});
    return result;
  }finally{await fsp.rm(temporary,{recursive:true,force:true});}
}
