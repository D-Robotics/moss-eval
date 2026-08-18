import { execFileSync } from 'node:child_process';

const distro = process.env.MOSS_EVAL_WSL_DISTRO || 'RDK-Moss-Ubuntu';
const image = process.env.MOSS_EVAL_IMAGE || 'moss-eval:local';
const script = [
  'test -x "$MOSS_BROWSER_EXECUTABLE" &&',
  '"$MOSS_BROWSER_EXECUTABLE" --headless --no-sandbox --disable-gpu',
  "--dump-dom 'data:text/html,<title>MOSS Browser Ready</title><main>success</main>'",
].join(' ');
const output = execFileSync(
  'wsl',
  ['--distribution', distro, '--exec', 'sudo', 'docker', 'run', '--rm', image, 'sh', '-lc', script],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
if (!output.includes('MOSS Browser Ready') || !output.includes('<main>success</main>')) {
  throw new Error(`Docker Chromium verification failed: ${output}`);
}
process.stdout.write(`${JSON.stringify({ ready: true, image, engine: 'chromium', isolated: true })}\n`);
