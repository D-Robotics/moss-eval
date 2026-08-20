import fsp from 'node:fs/promises';
import path from 'node:path';

export class EventStore {
  constructor(directory, options = {}) { this.directory = directory; this.limit = options.limit || 500; this.projections = new Map(); this.queues = new Map(); }
  async append(event) {
    const runId = String(event.data?.run_id || event.data?.runId || 'system').replace(/[^A-Za-z0-9._-]/g, '_');
    const file = path.join(this.directory, `${runId}.events.jsonl`);
    const previous = this.queues.get(file) || Promise.resolve();
    const pending = previous.then(async () => { await fsp.mkdir(this.directory, { recursive: true }); await fsp.appendFile(file, JSON.stringify(event) + '\n', 'utf8'); });
    this.queues.set(file, pending.catch(() => {}));
    await pending;
    const projection = [...(this.projections.get(runId) || []), event].slice(-this.limit);
    this.projections.set(runId, projection);
    return event;
  }
  project(runId) { return [...(this.projections.get(runId) || [])]; }
  async restore(runId) {
    const safe = String(runId).replace(/[^A-Za-z0-9._-]/g, '_');
    try {
      const text = await fsp.readFile(path.join(this.directory, `${safe}.events.jsonl`), 'utf8');
      const events = text.split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-this.limit);
      this.projections.set(safe, events);
      return events;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
}
