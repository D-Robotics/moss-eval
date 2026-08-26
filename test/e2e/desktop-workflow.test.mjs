import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EvaluationService } from '../../src/core/evaluation-service.mjs';
import { ingestLocalSource } from '../../src/core/source-ingestion.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');

test('desktop service inspects pinned public-style and local snapshots without modifying the original', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-desktop-e2e-'));
  const original = path.join(temp, 'original');
  const paths = { projectRoot, sources:path.join(temp,'data/sources'), targets:path.join(temp,'data/targets'), runs:path.join(temp,'data/runs') };
  try {
    await fsp.mkdir(path.join(original, 'packages/moss-agent'), { recursive:true });
    await fsp.writeFile(path.join(original, 'package.json'), JSON.stringify({ name:'moss-workspace', workspaces:['packages/moss-agent'] }), 'utf8');
    await fsp.writeFile(path.join(original, 'packages/moss-agent/package.json'), JSON.stringify({ name:'@rdk-moss/agent', version:'1.0.0', bin:{ moss:'dist/cli.mjs' } }), 'utf8');
    const before = await fsp.readFile(path.join(original, 'package.json'), 'utf8');
    const sourceRecord = await ingestLocalSource(original, { sourcesRoot:paths.sources, git:null });

    let completed;
    const completion = new Promise((resolve) => { completed=resolve; });
    let evaluatedOptions;
    const fakeEvaluate = async (options) => {
      evaluatedOptions=options;
      const runId='desktop-fixture-run'; const runDir=path.join(paths.runs,runId);
      await fsp.cp(path.join(projectRoot,'test/fixtures/artifacts/run-v1'),runDir,{recursive:true});
      options.onRunStart({run_id:runId,run_directory:runDir});
      return {runId,runDir,trials:[]};
    };
    const service = new EvaluationService({ paths, evaluateFn:fakeEvaluate, eventSink:(event)=>{if(event.type==='run_completed')completed(event);} });
    const localInspection = await service.inspect(sourceRecord);
    const pinnedInspection = await service.inspect({ ...sourceRecord, type:'github', revision:'a'.repeat(40), canonical_location:'https://github.com/example/moss.git' });
    assert.equal(localInspection.candidates[0].adapter,'moss');
    assert.equal(pinnedInspection.candidates[0].adapter,'moss');

    const prepared = await service.prepare({ confirmed:true, source_record:sourceRecord, adapter_id:'moss', configuration:{}, sandbox_policy:{network:'disabled'}, runtime:{kind:'docker'}, image_digest:'sha256:'+'b'.repeat(64), allow_prebuilt:true });
    assert.equal(prepared.target.source.fingerprint,sourceRecord.snapshot_fingerprint);
    await assert.rejects(() => service.start({ config_id:'mock.example.json', target_fingerprint:prepared.target.target_fingerprint, suite:'smoke', trials:1 }), /explicit authorization/);
    const started = await service.start({ config_id:'mock.example.json', target_fingerprint:prepared.target.target_fingerprint, suite:'smoke', trials:1, approve_agent_workspace_actions:true });
    assert.equal(started.run_id,'desktop-fixture-run');
    await completion;
    assert.equal(evaluatedOptions.config.execution.environment_overrides.image,prepared.target.image_digest);
    assert.equal(evaluatedOptions.targetCapabilitiesByAgent.mock.telemetry_level,'L3');
    assert.equal(evaluatedOptions.config.agents.mock.prepared_target_fingerprint,prepared.target.target_fingerprint);
    const manifest={schema_version:'1.0',adapter:{id:'manifest-command',api_version:'1.0'},runtime:'node',preparation:{working_directory:'.',steps:[]},launch:{command:'bin/agent.mjs',args:['--json'],protocol:'stream-json'},capabilities:{modes:['stream-json'],telemetry_level:'L1',tools:[],tags:[]},environment:{required:[],optional:[],secrets:[]},network:{preparation_required:false,runtime_required:false,allowed_hosts:[]},sandbox:{privileged:false,docker_socket:false,host_mounts:[]}};
    const manifestTarget=await service.prepare({confirmed:true,source_record:sourceRecord,adapter_id:'manifest-command',configuration:manifest,sandbox_policy:{network:'disabled'},runtime:{kind:'docker'},image_digest:'sha256:'+'d'.repeat(64),allow_prebuilt:true});
    const manifestCompletion=new Promise((resolve)=>{completed=resolve;});
    await service.start({config_id:'mock.example.json',target_fingerprint:manifestTarget.target.target_fingerprint,suite:'smoke',trials:1});
    assert.equal(evaluatedOptions.config.agents.mock.adapter,'command');
    assert.equal(evaluatedOptions.config.agents.mock.command,'/target/bin/agent.mjs');
    assert.deepEqual(evaluatedOptions.config.agents.mock.args,['--json','{instruction}']);
    await manifestCompletion;
    assert.equal(await fsp.readFile(path.join(original,'package.json'),'utf8'),before);
  } finally { await fsp.rm(temp,{recursive:true,force:true}); }
});

test('desktop MOSS run keeps user model credentials non-enumerable and requires network authorization', async (t) => {
  const temp=await fsp.mkdtemp(path.join(os.tmpdir(),'moss-desktop-model-'));
  t.after(()=>fsp.rm(temp,{recursive:true,force:true}));
  const original=path.join(temp,'original');
  const paths={projectRoot,sources:path.join(temp,'sources'),targets:path.join(temp,'targets'),runs:path.join(temp,'runs')};
  await fsp.mkdir(path.join(original,'packages/moss-agent'),{recursive:true});
  await fsp.writeFile(path.join(original,'package.json'),JSON.stringify({name:'moss-workspace',workspaces:['packages/moss-agent']}),'utf8');
  await fsp.writeFile(path.join(original,'packages/moss-agent/package.json'),JSON.stringify({name:'@rdk-moss/agent',version:'1.0.0',bin:{moss:'dist/cli.mjs'}}),'utf8');
  const sourceRecord=await ingestLocalSource(original,{sourcesRoot:paths.sources,git:null});
  let evaluatedOptions;
  let completed;
  const completion=new Promise((resolve)=>{completed=resolve;});
  const service=new EvaluationService({paths,evaluateFn:async(options)=>{evaluatedOptions=options;const runId='model-fixture-run';const runDir=path.join(paths.runs,runId);await fsp.cp(path.join(projectRoot,'test/fixtures/artifacts/run-v1'),runDir,{recursive:true});options.onRunStart({run_id:runId,run_directory:runDir});return {runId,runDir,trials:[]};},eventSink:(event)=>{if(event.type==='run_completed')completed(event);}});
  const prepared=await service.prepare({confirmed:true,source_record:sourceRecord,adapter_id:'moss',configuration:{},sandbox_policy:{network:'disabled'},runtime:{kind:'docker'},image_digest:`sha256:${'e'.repeat(64)}`,allow_prebuilt:true});
  const model_configuration={provider:'openai',model:'gpt-4o-mini',base_url:'https://api.openai.com',api_key:'never-persist-this-key'};
  await assert.rejects(()=>service.start({config_id:'mock.example.json',target_fingerprint:prepared.target.target_fingerprint,suite:'smoke',trials:1,model_configuration,approve_runtime_network:false,approve_agent_workspace_actions:true}),/explicit approval/);
  await service.start({config_id:'mock.example.json',target_fingerprint:prepared.target.target_fingerprint,suite:'smoke',trials:1,model_configuration,approve_runtime_network:true,approve_agent_workspace_actions:true});
  const agent=evaluatedOptions.config.agents.mock;
  assert.equal(agent.provider,'openai');assert.equal(agent.model,'gpt-4o-mini');assert.equal(agent._model_configuration.apiKey,'never-persist-this-key');
  assert.equal(Object.keys(agent).includes('_model_configuration'),false);
  assert.equal(agent._moss_auto_approve,true);assert.equal(Object.keys(agent).includes('_moss_auto_approve'),false);
  assert.equal(evaluatedOptions.config.execution.environment_overrides.network,'public');
  assert.doesNotMatch(JSON.stringify(evaluatedOptions),/never-persist-this-key/);
  await completion;
});
