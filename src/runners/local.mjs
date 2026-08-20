import { runProcess } from '../lib/process.mjs';

export class LocalRunner {
  constructor(configuration = {}, options = {}) {
    this.configuration = configuration;
    this.allow = Boolean(configuration.allow || options.allowLocal);
    this.name = 'local';
  }

  paths(context) {
    return {
      workspace: context.workspace,
      task: context.taskDir,
      run: context.runDir,
      trial: context.trialDir,
      eval: context.evalRoot,
    };
  }

  async run(command, context) {
    if (!this.allow) {
      throw new Error('Local runner is disabled. Pass --allow-local only for trusted tasks.');
    }
    return runProcess({
      ...command,
      cwd: context.workspace,
      env: { ...process.env, ...command.env },
      timeoutMs: context.timeoutMs,
      signal: context.signal,
      onStdout: context.onStdout,
      onStderr: context.onStderr,
    });
  }
}
