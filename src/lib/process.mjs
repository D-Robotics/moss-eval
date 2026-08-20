import { spawn } from 'node:child_process';

const DEFAULT_OUTPUT_LIMIT = 16 * 1024 * 1024;

function appendCapped(current, chunk, limit) {
  if (current.length >= limit) return current;
  const text = chunk.toString('utf8');
  return (current + text).slice(0, limit);
}

async function terminateProcess(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {}
  }
}

export async function runProcess(specification) {
  const {
    command,
    args = [],
    cwd,
    env = process.env,
    input = null,
    timeoutMs = 300000,
    outputLimit = DEFAULT_OUTPUT_LIMIT,
    onStdout,
    onStderr,
    signal,
  } = specification;

  if (!command) throw new Error('Process command is required');
  if (signal?.aborted) {
    const error = new Error('Process was cancelled before start');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    throw error;
  }
  const startedAt = new Date();
  const startMs = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let startError = null;
  let timeoutHandle;
  let aborted = false;

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });

  child.stdout.on('data', (chunk) => {
    stdout = appendCapped(stdout, chunk, outputLimit);
    if (onStdout) onStdout(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr = appendCapped(stderr, chunk, outputLimit);
    if (onStderr) onStderr(chunk);
  });

  if (input !== null && input !== undefined) child.stdin.end(String(input));
  else child.stdin.end();

  const abortListener = () => {
    aborted = true;
    void terminateProcess(child);
  };
  signal?.addEventListener('abort', abortListener, { once: true });
  const exit = await new Promise((resolve) => {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      await terminateProcess(child);
    }, timeoutMs);
    child.once('error', (error) => {
      startError = error;
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeoutHandle);
  signal?.removeEventListener('abort', abortListener);

  return {
    command,
    args,
    cwd,
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    aborted,
    startError: startError ? { code: startError.code, message: startError.message } : null,
    stdout,
    stderr,
    outputTruncated: stdout.length >= outputLimit || stderr.length >= outputLimit,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
  };
}
