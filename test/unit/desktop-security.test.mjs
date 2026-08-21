import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateIpcRequest } from '../../app/main/ipc-contract.mjs';
import { EventStore } from '../../app/main/event-store.mjs';
import { WorkerProtocolHost, WORKER_PROTOCOL_VERSION } from '../../app/main/worker-protocol.mjs';
import { EvaluationService } from '../../src/core/evaluation-service.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('narrow IPC rejects arbitrary process, PID, path and setting operations', () => {
  assert.throws(() => validateIpcRequest('eval:runCommand', { args: ['rm'] }), /not allowed/);
  assert.throws(() => validateIpcRequest('eval:killCommand', { pid: 1 }), /not allowed/);
  assert.throws(() => validateIpcRequest('run:get', { run_id: '../../escape' }), /invalid/);
  assert.throws(() => validateIpcRequest('settings:update', { command: 'anything' }), /Unknown setting/);
  assert.deepEqual(validateIpcRequest('run:cancel', { run_id: 'owned-run.1' }), { run_id: 'owned-run.1' });
  assert.deepEqual(validateIpcRequest('prepare:cancel', { preparation_id: 'prepare-1' }), { preparation_id: 'prepare-1' });
  assert.deepEqual(validateIpcRequest('prerequisite:remediate', { action: 'start-docker' }), { action: 'start-docker' });
  assert.throws(() => validateIpcRequest('prerequisite:remediate', { action: 'run-command', command: 'calc.exe' }), /Unsupported prerequisite action/);
  const modelRequest={target_fingerprint:'a'.repeat(64),approve_runtime_network:true,model_configuration:{provider:'openai-compatible',model:'custom-model',base_url:'https://models.example.com',api_key:'secret'}};
  assert.deepEqual(validateIpcRequest('model:testConnection',modelRequest),modelRequest);
  const minimalModelRequest={target_fingerprint:'b'.repeat(64),approve_runtime_network:true,model_configuration:{protocol:'auto',model:'deepseek-v4-flash',base_url:'https://ai-api.d-robotics.cc/v1',api_key:'secret'}};
  assert.deepEqual(validateIpcRequest('model:testConnection',minimalModelRequest),minimalModelRequest);
  assert.throws(()=>validateIpcRequest('model:testConnection',{...modelRequest,approve_runtime_network:false}),/authorization/);
  assert.throws(()=>validateIpcRequest('model:testConnection',{...modelRequest,model_configuration:{...modelRequest.model_configuration,base_url:'http://localhost:11434'}}),/HTTPS/);
  assert.throws(()=>validateIpcRequest('model:testConnection',{...modelRequest,model_configuration:{...modelRequest.model_configuration,command:'calc.exe'}}),/Unknown model configuration/);
  assert.throws(()=>validateIpcRequest('model:testConnection',{...minimalModelRequest,model_configuration:{...minimalModelRequest.model_configuration,protocol:'vendor-name'}}),/protocol/);
});

test('preload and BrowserWindow configuration expose no arbitrary process or filesystem bridge', async () => {
  const preload = await fsp.readFile(path.join(root, 'app/main/preload.cjs'), 'utf8');
  const main = await fsp.readFile(path.join(root, 'app/main/index.mjs'), 'utf8');
  const renderer = await fsp.readFile(path.join(root, 'app/renderer/app.mjs'), 'utf8');
  const workflow = await fsp.readFile(path.join(root, 'app/renderer/workflow.mjs'), 'utf8');
  assert.doesNotMatch(preload, /runCommand|killCommand|readConfig|writeConfig|showOpenDialog/);
  assert.match(preload, /require\('electron'\)/);
  assert.doesNotMatch(preload, /^\s*import\s/m);
  assert.match(main, /preload\.cjs/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.doesNotMatch(renderer, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.eval\(/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /c\.detail/);
  assert.match(renderer, /c\.remediation/);
  assert.match(renderer, /moss-eval\.pending-preparation\.v1/);
  assert.match(renderer, /resumePendingPreparation/);
  assert.match(renderer, /localStorage\.setItem/);
  assert.match(preload, /remediatePrerequisite/);
  assert.match(preload, /testModelConnection/);
  assert.match(renderer, /type:'password'/);
  assert.match(renderer, /api_key:modelApiKey\.value/);
  assert.doesNotMatch(renderer, /captureDraft=.*api_key/);
  assert.doesNotMatch(renderer, /id:'model-provider'/);
  assert.match(renderer, /id:'model-protocol'/);
  assert.match(renderer, /genericSecretsPanel\.hidden=moss/);
  assert.match(renderer, /aria-busy/);
  assert.match(workflow, /请先选择并分析要评测的 Agent/);
  assert.match(workflow, /请先选择电脑上的 Agent 项目文件夹/);
  assert.match(renderer, /查看技术详情/);
});

test('worker handshake is versioned and unknown operations cannot execute', async () => {
  const sent = [];
  const host = new WorkerProtocolHost({}, (message) => sent.push(message));
  assert.equal(host.handshake().protocol_version, WORKER_PROTOCOL_VERSION);
  await host.receive({ id: '1', protocol_version: '999', operation: 'start', args: [] });
  await host.receive({ id: '2', protocol_version: WORKER_PROTOCOL_VERSION, operation: 'exec', args: [] });
  assert.equal(sent[0].error.code, 'INCOMPATIBLE_WORKER_PROTOCOL');
  assert.equal(sent[1].error.code, 'UNKNOWN_WORKER_OPERATION');
});

test('event store appends safely and restores a bounded live projection', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-events-'));
  try {
    const store = new EventStore(directory, { limit: 2 });
    await Promise.all([1, 2, 3].map((n) => store.append({ type: 'trial', data: { run_id: 'run-1', n } })));
    assert.deepEqual(store.project('run-1').map((event) => event.data.n), [2, 3]);
    const restored = await new EventStore(directory, { limit: 2 }).restore('run-1');
    assert.deepEqual(restored.map((event) => event.data.n), [2, 3]);
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});

test('shared evaluation service classifies interrupted and corrupt run history', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-service-'));
  try {
    const paths = { projectRoot: root, sources: path.join(directory, 'sources'), targets: path.join(directory, 'targets'), runs: path.join(directory, 'runs') };
    await fsp.mkdir(path.join(paths.runs, 'interrupted'), { recursive: true });
    await fsp.mkdir(path.join(paths.runs, 'corrupt'), { recursive: true });
    await fsp.writeFile(path.join(paths.runs, 'corrupt', 'run.json'), '{', 'utf8');
    const service = new EvaluationService({ paths });
    const runs = await service.listRuns();
    assert.equal(runs.find((run) => run.id === 'interrupted').status, 'interrupted');
    assert.equal(runs.find((run) => run.id === 'corrupt').status, 'corrupt');
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
});

test('desktop worker runtime accepts only a bounded Docker command value', async () => {
  const service = new EvaluationService({ paths: { projectRoot: root, sources: 'sources', targets: 'targets', runs: 'runs' } });
  assert.deepEqual(service.configureRuntime({ docker_command: 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' }), { docker_command_configured: true });
  assert.throws(() => service.configureRuntime({ docker_command: 'docker\ncalc.exe' }), /Invalid Docker runtime command/);
  assert.throws(() => service.configureRuntime({ docker_command: 'C:\\Windows\\System32\\calc.exe' }), /Invalid Docker runtime command/);
  assert.throws(() => service.configureRuntime({}), /Invalid Docker runtime command/);
});
