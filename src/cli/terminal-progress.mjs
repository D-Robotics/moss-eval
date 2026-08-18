function elapsed(startedAt, now) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function trialKey(value) {
  return `${value.task.id}|${value.agentName || value.agent}|${value.replicate}`;
}

function trialLabel(value) {
  return `${value.task.id} ${value.agentName || value.agent} #${value.replicate}`;
}

function symbol(status) {
  if (status === 'passed') return 'PASS';
  if (status === 'invalid') return 'INVALID';
  return 'FAIL';
}

export class TerminalProgress {
  constructor(options = {}) {
    this.stream = options.stream || process.stdout;
    this.now = options.now || (() => Date.now());
    this.mode = options.mode === 'auto' || !options.mode
      ? (this.stream.isTTY ? 'dashboard' : 'plain')
      : options.mode;
    this.startedAt = this.now();
    this.total = 0;
    this.completed = 0;
    this.counts = { passed: 0, failed: 0, invalid: 0 };
    this.active = new Map();
    this.recent = [];
    this.renderedLines = 0;
    this.timer = null;
    this.runDirectory = null;
    this.exitHandler = () => this.restoreCursor();
  }

  onRunStart(run) {
    this.total = run.trial_count;
    this.runDirectory = run.run_directory;
    if (this.mode === 'dashboard') {
      this.stream.write('\x1b[?25l');
      process.once('exit', this.exitHandler);
      this.timer = setInterval(() => this.render(), 1000);
      this.timer.unref?.();
      this.render();
    } else if (this.mode === 'plain') {
      this.stream.write(`[run] ${run.run_id} trials=${run.trial_count} output=${run.run_directory}\n`);
    }
  }

  onTrialStart(unit) {
    const item = { ...unit, startedAt: this.now() };
    this.active.set(trialKey(item), item);
    if (this.mode === 'plain') this.stream.write(`[start] ${trialLabel(item)}\n`);
    else if (this.mode === 'dashboard') this.render();
  }

  onTrialComplete(trial, completed, total) {
    this.active.delete(trialKey(trial));
    this.completed = completed;
    this.total = total;
    this.counts[trial.status] = (this.counts[trial.status] || 0) + 1;
    this.recent.unshift({
      label: trialLabel(trial),
      status: trial.status,
      duration: trial.metrics?.duration_ms || 0,
      failure: trial.failure_category || null,
    });
    this.recent = this.recent.slice(0, 3);
    if (this.mode === 'plain') {
      const reason = trial.failure_category ? ` reason=${trial.failure_category}` : '';
      this.stream.write(
        `[${completed}/${total}] ${trialLabel(trial)} ${trial.status} ${Math.round((trial.metrics?.duration_ms || 0) / 1000)}s${reason}\n`,
      );
    } else if (this.mode === 'dashboard') this.render();
  }

  lines() {
    const percent = this.total ? Math.floor((this.completed / this.total) * 100) : 0;
    const lines = [
      `MOSS Eval  ${elapsed(this.startedAt, this.now())}  ${this.completed}/${this.total} (${percent}%)`,
      `PASS ${this.counts.passed}  FAIL ${this.counts.failed}  INVALID ${this.counts.invalid}  RUNNING ${this.active.size}`,
      'Active trials:',
    ];
    const active = [...this.active.values()].slice(0, 6);
    if (active.length === 0) lines.push('  (waiting)');
    else {
      for (const item of active) lines.push(`  ${trialLabel(item)}  ${elapsed(item.startedAt, this.now())}`);
    }
    lines.push('Recent results:');
    if (this.recent.length === 0) lines.push('  (none)');
    else {
      for (const item of this.recent) {
        const reason = item.failure ? ` · ${item.failure}` : '';
        lines.push(`  ${symbol(item.status)}  ${item.label}  ${Math.round(item.duration / 1000)}s${reason}`);
      }
    }
    if (this.runDirectory) lines.push(`Artifacts: ${this.runDirectory}`);
    return lines;
  }

  render() {
    if (this.mode !== 'dashboard') return;
    const width = Math.max(40, this.stream.columns || 120);
    const next = this.lines().map((line) => line.length > width ? line.slice(0, width - 1) + '…' : line);
    if (this.renderedLines > 0) this.stream.write(`\x1b[${this.renderedLines}F`);
    const count = Math.max(this.renderedLines, next.length);
    for (let index = 0; index < count; index += 1) {
      this.stream.write(`\x1b[2K${next[index] || ''}\n`);
    }
    this.renderedLines = count;
  }

  restoreCursor() {
    if (this.mode === 'dashboard') this.stream.write('\x1b[?25h');
  }

  finish() {
    if (this.timer) clearInterval(this.timer);
    if (this.mode === 'dashboard') {
      this.render();
      this.restoreCursor();
      process.removeListener('exit', this.exitHandler);
    }
  }
}
