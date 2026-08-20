import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol.mjs';

export class WorkerClient extends EventEmitter {
  constructor(utilityProcess, options) { super(); this.utilityProcess = utilityProcess; this.options = options; this.pending = new Map(); this.sequence = 0; this.child = null; this.ready = null; }
  start() {
    if (this.child) return this.ready;
    this.child = this.utilityProcess.fork(path.join(import.meta.dirname, 'evaluation-worker.mjs'), [], { env: { ...process.env, MOSS_EVAL_USER_DATA: this.options.userDataRoot, MOSS_EVAL_PACKAGED: this.options.packaged ? '1' : '0', MOSS_EVAL_RESOURCES: this.options.resourcesPath || '', MOSS_EVAL_PROJECT_ROOT: this.options.projectRoot || '' }, serviceName: 'moss-eval-worker' });
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Evaluation worker handshake timed out')), 10000);
      this.child.on('message', (message) => {
        if (message.type === 'handshake') { clearTimeout(timeout); if (message.protocol_version !== WORKER_PROTOCOL_VERSION) reject(new Error('Incompatible evaluation worker')); else resolve(message); return; }
        if (message.type === 'event') { this.emit('event', message.event); return; }
        const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.ok ? pending.resolve(message.result) : pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      });
      this.child.on('exit', (code) => { for (const pending of this.pending.values()) pending.reject(new Error(`Evaluation worker exited (${code})`)); this.pending.clear(); this.child = null; });
    });
    return this.ready;
  }
  async request(operation, ...args) { await this.start(); const id = `request-${++this.sequence}`; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.postMessage({ id, protocol_version: WORKER_PROTOCOL_VERSION, operation, args }); }); }
}
