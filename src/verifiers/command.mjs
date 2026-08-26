import { expandList } from '../adapters/template.mjs';
import { graderResult } from './result.mjs';

function commandParts(grader) {
  if (!Array.isArray(grader.command) || grader.command.length === 0) {
    throw new Error('Command grader requires a non-empty command array');
  }
  return { command: grader.command[0], args: grader.command.slice(1) };
}

export async function runCommandVerifier(grader, context) {
  const started = Date.now();
  try {
    const parts = commandParts(grader);
    const variables = {
      workspace: context.paths.workspace,
      taskDir: context.paths.task,
      runDir: context.paths.run,
      trialDir: context.paths.trial,
      taskId: context.task.id,
      replicate: context.replicate,
    };
    const command = {
      command: expandList([parts.command], variables)[0],
      args: expandList(parts.args, variables),
      env: grader.env || {},
      input: grader.input || null,
    };
    const processResult = await context.runner.run(command, {
      ...context.runnerContext,
      phase: 'grader',
      timeoutMs: grader.timeout_seconds * 1000,
      onStdout: null,
      onStderr: null,
    });
    if (processResult.startError) {
      return graderResult(grader, 'error', {
        reason: 'Verifier process could not start',
        details: { error_code: processResult.startError.code },
        durationMs: Date.now() - started,
      });
    }
    const expectedCodes = grader.expect?.exit_codes || [0];
    const failures = [];
    if (!expectedCodes.includes(processResult.exitCode)) {
      failures.push('exit code ' + processResult.exitCode + ' not in ' + expectedCodes.join(','));
    }
    if (grader.expect?.stdout_matches) {
      const expression = new RegExp(grader.expect.stdout_matches, grader.expect.stdout_flags || 'm');
      if (!expression.test(processResult.stdout)) failures.push('stdout did not match required pattern');
    }
    if (grader.expect?.stderr_matches) {
      const expression = new RegExp(grader.expect.stderr_matches, grader.expect.stderr_flags || 'm');
      if (!expression.test(processResult.stderr)) failures.push('stderr did not match required pattern');
    }
    if (grader.expect?.stdout_not_matches) {
      const expression = new RegExp(grader.expect.stdout_not_matches, grader.expect.stdout_flags || 'm');
      if (expression.test(processResult.stdout)) failures.push('stdout matched forbidden pattern');
    }
    return graderResult(grader, failures.length ? 'failed' : 'passed', {
      reason: failures.length ? failures.join('; ') : 'Verifier command passed',
      details: {
        exit_code: processResult.exitCode,
        timed_out: processResult.timedOut,
        stdout_tail: processResult.stdout.slice(-2000),
        stderr_tail: processResult.stderr.slice(-2000),
        mount_policy: processResult.mountPolicy || null,
      },
      durationMs: Date.now() - started,
    });
  } catch (error) {
    return graderResult(grader, 'error', {
      reason: error.message,
      durationMs: Date.now() - started,
    });
  }
}
