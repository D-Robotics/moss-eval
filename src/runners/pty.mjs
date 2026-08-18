export class PtyRunner {
  constructor(configuration = {}) {
    this.configuration = configuration;
    this.name = 'pty';
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
    let pty;
    try {
      pty = await import('node-pty');
    } catch {
      throw new Error('PTY runner requires the optional node-pty package.');
    }

    const startedAt = new Date();
    const startMs = Date.now();
    let output = '';
    let timedOut = false;
    let dataSubscription;
    let exitSubscription;
    const processHandle = pty.spawn(command.command, command.args, {
      name: this.configuration.term || 'xterm-256color',
      cols: this.configuration.cols || 120,
      rows: this.configuration.rows || 40,
      cwd: context.workspace,
      env: { ...process.env, ...command.env },
    });
    if (command.input) processHandle.write(String(command.input));

    const exit = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          processHandle.kill();
        } catch {}
      }, context.timeoutMs);
      dataSubscription = processHandle.onData((data) => {
        output = (output + data).slice(0, 16 * 1024 * 1024);
        if (context.onStdout) context.onStdout(Buffer.from(data));
      });
      exitSubscription = processHandle.onExit((event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
    dataSubscription?.dispose();
    exitSubscription?.dispose();
    // node-pty 1.x can leave its Windows ConPTY output worker alive after a
    // natural child exit. Calling public kill() then launches a process-list
    // helper that races the already-closed console. Dispose only the leftover
    // ConPTY handles; fall back to kill if internals change in a future release.
    if (process.platform === 'win32') {
      try {
        const agent = processHandle._agent;
        if (agent?._useConpty && !agent._useConptyDll) {
          agent._ptyNative.kill(agent._pty, false);
          agent._conoutSocketWorker?.dispose();
        } else {
          processHandle.kill();
        }
      } catch {}
    }

    return {
      command: command.command,
      args: command.args,
      cwd: context.workspace,
      exitCode: exit.exitCode,
      signal: exit.signal || null,
      timedOut,
      startError: null,
      stdout: output,
      stderr: '',
      outputTruncated: output.length >= 16 * 1024 * 1024,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
  }
}
