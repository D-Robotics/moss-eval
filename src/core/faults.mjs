import { expandList } from '../adapters/template.mjs';

export async function prepareFaults(task, context) {
  const environment = {};
  const results = [];
  const variables = {
    workspace: context.paths.workspace,
    taskDir: context.paths.task,
    runDir: context.paths.run,
    trialDir: context.paths.trial,
    taskId: task.id,
    replicate: context.replicate,
  };

  for (const fault of task.faults || []) {
    if (fault.type === 'env') {
      environment[fault.name] = String(fault.value);
      results.push({ id: fault.id, type: fault.type, status: 'prepared' });
      continue;
    }
    if (fault.type === 'setup_command') {
      if (!Array.isArray(fault.command) || fault.command.length === 0) {
        throw new Error('Fault setup command must be a non-empty array');
      }
      const parts = expandList(fault.command, variables);
      const result = await context.runner.run(
        { command: parts[0], args: parts.slice(1), env: fault.env || {}, input: null },
        {
          ...context.runnerContext,
          timeoutMs: (fault.timeout_seconds || 30) * 1000,
          onStdout: null,
          onStderr: null,
        },
      );
      const passed = result.exitCode === 0 && !result.timedOut && !result.startError;
      results.push({
        id: fault.id,
        type: fault.type,
        status: passed ? 'prepared' : 'error',
        exit_code: result.exitCode,
      });
      if (!passed && fault.required !== false) {
        throw new Error('Required fault setup failed: ' + fault.id);
      }
      continue;
    }
    throw new Error('Unsupported fault type: ' + fault.type);
  }
  return { environment, results };
}
