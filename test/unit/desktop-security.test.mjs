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
});

test('preload and BrowserWindow configuration expose no arbitrary process or filesystem bridge', async () => {
  const preload = await fsp.readFile(path.join(root, 'app/main/preload.mjs'), 'utf8');
  const main = await fsp.readFile(path.join(root, 'app/main/index.mjs'), 'utf8');
  const renderer = await fsp.readFile(path.join(root, 'app/renderer/app.mjs'), 'utf8');
  assert.doesNotMatch(preload, /runCommand|killCommand|readConfig|writeConfig|showOpenDialog/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.doesNotMatch(renderer, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.eval\(/);
  assert.match(renderer, /textContent/);
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
