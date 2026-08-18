import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { PtyRunner } from '../src/runners/pty.mjs';

const workspace = path.resolve('.moss-eval', 'env-check', 'pty');
await mkdir(workspace, { recursive: true });
const runner = new PtyRunner({ cols: 120, rows: 40 });
const result = await runner.run(
  { command: process.platform === 'win32' ? 'moss.cmd' : 'moss', args: ['--version'], env: {} },
  { workspace, timeoutMs: 15_000 },
);
const cleanOutput = result.stdout.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '').trim();
if (result.timedOut || result.exitCode !== 0 || !cleanOutput.includes('moss v0.6.0')) {
  throw new Error(`MOSS PTY check failed: ${JSON.stringify(result)}`);
}
process.stdout.write(
  `${JSON.stringify({ ready: true, mode: 'pty', version: 'moss v0.6.0', duration_ms: result.durationMs })}\n`,
);
