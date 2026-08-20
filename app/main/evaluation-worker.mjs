import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkerProtocolHost } from './worker-protocol.mjs';

const projectRoot = process.env.MOSS_EVAL_PROJECT_ROOT;
const [{ resolveStoragePaths, ensureStoragePaths }, { EvaluationService }] = await Promise.all([
  import(pathToFileURL(path.join(projectRoot, 'src/core/storage-paths.mjs')).href),
  import(pathToFileURL(path.join(projectRoot, 'src/core/evaluation-service.mjs')).href),
]);
const paths = await ensureStoragePaths(resolveStoragePaths({ userDataRoot: process.env.MOSS_EVAL_USER_DATA, packaged: process.env.MOSS_EVAL_PACKAGED === '1', resourcesPath: process.env.MOSS_EVAL_RESOURCES, projectRoot: process.env.MOSS_EVAL_PROJECT_ROOT }));
const send = (message) => process.parentPort.postMessage(message);
const service = new EvaluationService({ paths, eventSink: (event) => send({ type: 'event', event }) });
const host = new WorkerProtocolHost(service, send);
send(host.handshake());
process.parentPort.on('message', (event) => host.receive(event.data));
