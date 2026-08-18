import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/lib/process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['bin', 'scripts', 'src', 'test', 'examples'];
const files = [];

async function walk(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
}

for (const directory of directories) await walk(path.join(root, directory));
for (const file of files) {
  const result = await runProcess({
    command: process.execPath,
    args: ['--check', file],
    cwd: root,
    timeoutMs: 10000,
  });
  if (result.exitCode !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(1);
  }
}
process.stdout.write('syntax ok: ' + files.length + ' files\n');
