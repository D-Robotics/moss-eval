import { CommandAdapter } from './command.mjs';
import { collectMossNativeTelemetry } from '../core/native-telemetry.mjs';

export class MossAdapter extends CommandAdapter {
  build(task, context) {
    const command = super.build(task, context);
    command.env.MOSS_EVAL_RUNTIME_MODE = task.mode;
    command.metadata.runtimeMode = task.mode;
    return command;
  }

  async collectTelemetry(workspace, options = {}) {
    return collectMossNativeTelemetry(workspace, options);
  }
}
