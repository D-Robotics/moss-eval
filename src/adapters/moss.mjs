import { CommandAdapter } from './command.mjs';
import { collectMossNativeTelemetry } from '../core/native-telemetry.mjs';
import { mossConfigFile, publicModelConfiguration } from '../core/model-configuration.mjs';

export class MossAdapter extends CommandAdapter {
  build(task, context) {
    const command = super.build(task, context);
    command.env.MOSS_EVAL_RUNTIME_MODE = task.mode;
    command.metadata.runtimeMode = task.mode;
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
