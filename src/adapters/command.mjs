import { resolveRuntimeEnvironment } from '../core/config.mjs';
import { expandList, expandTemplate } from './template.mjs';

export class CommandAdapter {
  constructor(name, configuration) {
    this.name = name;
    this.configuration = configuration;
  }

  build(task, context) {
    const config = this.configuration;
    const variables = {
      instruction: task.instruction,
      workspace: context.paths.workspace,
      taskDir: context.paths.task,
      runDir: context.paths.run,
      trialDir: context.paths.trial,
      taskId: task.id,
      replicate: context.replicate,
      mode: task.mode,
      configDir: config._config_directory,
      evalRoot: context.paths.eval,
    };
    const modeArgs = config.mode_args?.[task.mode] || [];
    const baseArgs = config.mode_base_args?.[task.mode] || config.args || [];
    const args = expandList([...baseArgs, ...modeArgs], variables);
    const command = expandTemplate(config.mode_commands?.[task.mode] || config.command, variables);
    const input = config.input === 'instruction' ? task.instruction : config.input || null;
    return {
      command,
      args,
      input,
      env: {
        ...resolveRuntimeEnvironment(config.env || {}),
        ...resolveRuntimeEnvironment(task.environment.env || {}),
        ...context.faultEnvironment,
        MOSS_EVAL_TASK_ID: task.id,
        MOSS_EVAL_REPLICATE: String(context.replicate),
        MOSS_EVAL_WORKSPACE: context.paths.workspace,
      },
      metadata: {
        adapter: config.adapter,
        agent: this.name,
        model: config.model || null,
        provider: config.provider || null,
      },
    };
  }
}
