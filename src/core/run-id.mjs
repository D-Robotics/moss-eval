import { randomUUID } from 'node:crypto';
import { sanitizeId } from '../lib/paths.mjs';

export function createRunId(label = 'run', options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const entropy = options.entropy || randomUUID().replaceAll('-', '').slice(0, 12);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.', '').replace('Z', 'Z');
  return sanitizeId(`${stamp}-${entropy}-${label}`);
}
