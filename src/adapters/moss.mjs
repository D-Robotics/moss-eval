import { CommandAdapter } from './command.mjs';
import { collectMossNativeTelemetry } from '../core/native-telemetry.mjs';
import { mossConfigFile, publicModelConfiguration } from '../core/model-configuration.mjs';

export class MossAdapter extends CommandAdapter {
  build(task, context) {
    const receiptPath = `results/${task.id}.json`;
    const instruction = `${task.instruction}\n\nEvaluation contract: the exact task ID is ${task.id}. You MUST write the required receipt to ${receiptPath}; do not try to infer the task ID from the environment.`;
    const command = super.build({ ...task, instruction }, context);
    command.env.MOSS_EVAL_RUNTIME_MODE = task.mode;
    command.metadata.runtimeMode = task.mode;
    if (this.configuration._moss_auto_approve === true) {
      command.env.MOSS_CLI_AUTO_APPROVE = '1';
      command.metadata.isolated_workspace_actions_authorized = true;
    }
    const modelConfiguration = this.configuration._model_configuration;
    if (modelConfiguration) {
      const configPath = '.secrets/moss-model.json';
      command.args.unshift('--config-file', `/run/${configPath}`);
      command.secret_files = [{ path: configPath, content: mossConfigFile(modelConfiguration) }];
      command.metadata.model_configuration = publicModelConfiguration(modelConfiguration);
    }
    return command;
  }

  async collectTelemetry(workspace, options = {}) {
    return collectMossNativeTelemetry(workspace, options);
  }

  diagnoseProcess(processResult) {
    const stderr = String(processResult?.stderr || '');
    if (
      processResult?.exitCode !== 0 &&
      (/(?:exec:\s*["']moss["']|moss): executable file not found in \$PATH/i.test(stderr) ||
        /Cannot find module ['"]\/target\/packages\/moss-agent\/dist\/cli\.js['"]/i.test(stderr))
    ) {
      return {
        invalid: true,
        category: 'environment_error',
        code: 'MOSS_ENTRYPOINT_UNAVAILABLE',
        message: 'The prepared MOSS CLI entry point is unavailable in the evaluation image.',
      };
    }
    if (
      processResult?.exitCode !== 0 &&
      /(?:No model configured yet|Moss needs a model configuration before it can run)/i.test(stderr)
    ) {
      return {
        invalid: true,
        category: 'configuration_error',
        code: 'MOSS_MODEL_NOT_CONFIGURED',
        message: 'MOSS requires a model configuration before evaluation can start.',
      };
    }
    return null;
  }
}
