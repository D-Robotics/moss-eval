import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

export async function readJson(filePath) {
  const raw = await fsp.readFile(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = 'Invalid JSON in ' + filePath + ': ' + error.message;
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp-' + process.pid + '-' + Date.now();
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fsp.rename(temporary, filePath);
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashObject(value) {
  return sha256(stableStringify(value));
}

export function redactObject(value, secrets = []) {
  const secretValues = secrets
    .filter((item) => typeof item === 'string' && item.length >= 4)
    .sort((left, right) => right.length - left.length);

  const visit = (current, key = '') => {
    if (current === null || current === undefined) return current;
    if (typeof current === 'string') {
      let output = current;
      for (const secret of secretValues) output = output.split(secret).join('[REDACTED]');
      output = output
        .replace(/(api[_-]?key|token|password|secret)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[REDACTED]')
        .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED]');
      return output;
    }
    if (Array.isArray(current)) return current.map((item) => visit(item));
    if (typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current).map(([childKey, childValue]) => {
          if (/api[_-]?key|password|secret|authorization/i.test(childKey)) {
            return [childKey, childValue ? '[REDACTED]' : childValue];
          }
          return [childKey, visit(childValue, childKey)];
        }),
      );
    }
    return current;
  };

  return visit(value);
}
