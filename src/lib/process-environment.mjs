import path from 'node:path';

export function withExecutableDirectory(command, environment = process.env) {
  const result = { ...environment };
  if (!path.isAbsolute(String(command || ''))) return result;
  const pathKey = Object.keys(result).find((key) => key.toLowerCase() === 'path') || 'PATH';
  const directory = path.dirname(command);
  const entries = String(result[pathKey] || '').split(path.delimiter).filter(Boolean);
  if (!entries.some((entry) => path.normalize(entry).toLowerCase() === path.normalize(directory).toLowerCase())) entries.unshift(directory);
  result[pathKey] = entries.join(path.delimiter);
  return result;
}
