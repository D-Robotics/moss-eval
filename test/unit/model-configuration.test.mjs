import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAdapter } from '../../src/adapters/index.mjs';
import { EvaluationService } from '../../src/core/evaluation-service.mjs';
import { MODEL_PROTOCOLS, MODEL_PROVIDER_PRESETS, inferModelProtocol, mossConfigFile, publicModelConfiguration, validateModelConfiguration } from '../../src/core/model-configuration.mjs';
import { redactObject, writeJson } from '../../src/lib/json.mjs';
import { DockerRunner } from '../../src/runners/docker.mjs';

test('model configuration infers protocol from URL and accepts custom HTTPS gateways', () => {
  assert.deepEqual(Object.keys(MODEL_PROVIDER_PRESETS), ['deepseek', 'qwen', 'openai', 'anthropic', 'openai-compatible']);
  assert.deepEqual(MODEL_PROTOCOLS, ['auto', 'openai-compatible', 'anthropic']);
  const configured = validateModelConfiguration({ provider: 'deepseek', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com', api_key: 'secret' });
  assert.deepEqual(publicModelConfiguration(configured), { provider: 'deepseek', protocol: 'openai-compatible', model: 'deepseek-v4-flash', base_url: 'https://api.deepseek.com', api_key_configured: true });
  assert.equal(JSON.parse(mossConfigFile(configured)).apiKey, 'secret');
  const custom = validateModelConfiguration({ model: 'deepseek-v4-flash', base_url: 'https://ai-api.d-robotics.cc/v1', api_key: 'secret' });
  assert.deepEqual(publicModelConfiguration(custom), { provider: 'openai-compatible', protocol: 'openai-compatible', model: 'deepseek-v4-flash', base_url: 'https://ai-api.d-robotics.cc/v1', api_key_configured: true });
  assert.equal(inferModelProtocol('https://api.anthropic.com/v1'), 'anthropic');
  assert.equal(validateModelConfiguration({ protocol:'anthropic', model:'custom-claude', base_url:'https://gateway.example.com', api_key:'secret' }).provider, 'anthropic');
  assert.throws(() => validateModelConfiguration({ provider: 'openai-compatible', model: 'local', base_url: 'http://localhost:11434', api_key: 'secret' }), /HTTPS/);
  assert.throws(() => validateModelConfiguration({ provider: 'unknown', model: 'x', base_url: 'https://example.com', api_key: 'secret' }), /Unsupported/);
  assert.throws(() => validateModelConfiguration({ protocol: 'unknown', model: 'x', base_url: 'https://example.com', api_key: 'secret' }), /protocol/);
});

test('provider-generated partial API key masks are removed from persisted text', () => {
  const value=redactObject('Incorrect API key: sk-moss-********************robe');
  assert.equal(value,'Incorrect API key: [REDACTED]');
});

test('MOSS adapter passes only a temporary config path and public model provenance', () => {
  const adapter = createAdapter('moss', { adapter: 'moss', command: 'moss', args: ['{instruction}'] });
  Object.defineProperty(adapter.configuration, '_model_configuration', { value: validateModelConfiguration({ provider: 'anthropic', model: 'claude', base_url: 'https://api.anthropic.com', api_key: 'never-log-me' }), enumerable: false });
  const command = adapter.build({ id: 'task', instruction: 'work', mode: 'stream-json', environment: { env: {} } }, { paths: { workspace:'/workspace', task:'/task', run:'/run', trial:'/run', eval:'/eval' }, replicate:1, faultEnvironment:{} });
  assert.deepEqual(command.args.slice(0, 2), ['--config-file', '/run/.secrets/moss-model.json']);
  assert.equal(command.metadata.model_configuration.api_key_configured, true);
  assert.doesNotMatch(JSON.stringify({ args:command.args, env:command.env, metadata:command.metadata }), /never-log-me/);
  assert.match(command.secret_files[0].content, /never-log-me/);
});

test('Docker runner removes transient secret files even when process execution fails', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-eval-secret-file-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const trialDir = path.join(root, 'run', 'trial');
  await Promise.all([fsp.mkdir(trialDir, { recursive:true }), fsp.mkdir(path.join(root, 'workspace')), fsp.mkdir(path.join(root, 'task'))]);
  const secret = 'ephemeral-model-key';
  const processRunner = async (spec) => {
    if (spec.args.includes('inspect')) return { exitCode:0, stdout:`sha256:${'4'.repeat(64)}\n`, stderr:'', startError:null, timedOut:false };
    assert.equal(await fsp.readFile(path.join(trialDir, '.secrets', 'moss-model.json'), 'utf8'), secret);
    assert.doesNotMatch(JSON.stringify({ args:spec.args, env:spec.env }), new RegExp(secret));
    throw new Error('simulated container failure');
  };
  const runner = new DockerRunner({ process_runner:processRunner, command:path.resolve('D:/Docker/docker.exe') });
  await assert.rejects(() => runner.run({ command:'moss', args:['--config-file','/run/.secrets/moss-model.json'], env:{}, metadata:{secret_env_names:[]}, secret_files:[{path:'.secrets/moss-model.json',content:secret}] }, {
    task:{id:'task',environment:{image:'secret-cleanup:test',network:'disabled',cpu:1,memory_mb:512,pids:32,disk_mb:128,read_only_root:true}},
    replicate:1,workspace:path.join(root,'workspace'),taskDir:path.join(root,'task'),trialDir,runDir:path.join(root,'run'),evalRoot:root,timeoutMs:1000,
  }), /simulated/);
  await assert.rejects(() => fsp.access(path.join(trialDir, '.secrets', 'moss-model.json')), { code:'ENOENT' });
});

test('connection test requires authorization and returns only sanitized diagnostics', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-model-test-service-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const targetId = 'a'.repeat(64);
  const paths = { projectRoot:path.resolve(import.meta.dirname,'../..'), cache:path.join(root,'cache'), targets:path.join(root,'targets'), sources:path.join(root,'sources'), runs:path.join(root,'runs') };
  await fsp.mkdir(path.join(paths.targets,targetId),{recursive:true});
  await writeJson(path.join(paths.targets,targetId,'prepared-target.json'),{schema_version:'1.0',target_fingerprint:targetId,source:{fingerprint:'b'.repeat(64)},adapter:{id:'moss',api_version:'1.0',fingerprint:'c'.repeat(64)},image_digest:`sha256:${'d'.repeat(64)}`,capabilities:{modes:['stream-json'],telemetry_level:'L3'}});
  let captured;
  const service = new EvaluationService({ paths, runnerFactory:()=>({run:async(command,context)=>{captured={command,context};return {exitCode:0,stdout:'{"schema_version":"1.0","ok":true,"status":200,"latency_ms":12}\n',stderr:'',durationMs:15,timedOut:false};}}) });
  const request={target_fingerprint:targetId,approve_runtime_network:true,model_configuration:{provider:'openai',model:'gpt-4o-mini',base_url:'https://api.openai.com',api_key:'service-secret'}};
  const result=await service.testModelConnection(request);
  assert.equal(result.ok,true);assert.equal(result.latency_ms,12);assert.equal(result.configuration.api_key_configured,true);
  assert.doesNotMatch(JSON.stringify(result),/service-secret/);
  assert.doesNotMatch(JSON.stringify({args:captured.command.args,env:captured.command.env,metadata:captured.command.metadata}),/service-secret/);
  await assert.rejects(()=>service.testModelConnection({...request,approve_runtime_network:false}),/authorization/);
});
