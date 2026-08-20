export const WORKER_PROTOCOL_VERSION = '1.0';

export class WorkerProtocolHost {
  constructor(service, send) { this.service = service; this.send = send; }
  handshake() { return { type: 'handshake', protocol_version: WORKER_PROTOCOL_VERSION, service_version: '0.1.0' }; }
  async receive(message) {
    if (message?.protocol_version !== WORKER_PROTOCOL_VERSION) return this.send({ id: message?.id, ok: false, error: { code: 'INCOMPATIBLE_WORKER_PROTOCOL', message: 'Worker protocol version mismatch' } });
    const methods = { inspect: 'inspect', prepare: 'prepare', cancelPreparation: 'cancelPreparation', start: 'start', cancel: 'cancel', listRuns: 'listRuns', queryRun: 'queryRun', exportRun: 'exportRun', listTasks: 'listTasks', addGithubSource: 'addGithubSource', addLocalSource: 'addLocalSource' };
    const method = methods[message.operation];
    if (!method) return this.send({ id: message.id, ok: false, error: { code: 'UNKNOWN_WORKER_OPERATION', message: 'Unknown worker operation' } });
    try { return this.send({ id: message.id, ok: true, result: await this.service[method](...(message.args || [])) }); }
    catch (error) { return this.send({ id: message.id, ok: false, error: { code: error.code || 'WORKER_ERROR', message: error.message } }); }
  }
}
