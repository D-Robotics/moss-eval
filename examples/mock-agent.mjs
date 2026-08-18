#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';

const taskId = process.env.MOSS_EVAL_TASK_ID;
const workspace = process.env.MOSS_EVAL_WORKSPACE || process.cwd();

function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\n');
}

async function write(relative, content) {
  const target = path.join(workspace, relative);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
}

emit({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'I will inspect the workspace and complete ' + taskId + '.' },
      { type: 'tool_use', id: 'call-1', name: 'filesystem', input: { task_id: taskId } }
    ]
  }
});

if (taskId === 'smoke-create-file') {
  await write('output/hello.txt', 'MOSS eval ready\n');
} else if (taskId === 'smoke-fix-config') {
  await write('config.json', JSON.stringify({ name: 'demo', enabled: true }, null, 2) + '\n');
} else if (taskId === 'smoke-context-summary') {
  const facts = await fsp.readFile(path.join(workspace, 'facts.txt'), 'utf8');
  const names = facts.split(/\r?\n/).filter(Boolean).join(', ');
  await write('output/summary.txt', 'Remembered: ' + names + '\n');
} else if (taskId === 'smoke-recovery') {
  emit({ type: 'retry', source: 'agent', data: { reason: 'simulated transient failure' } });
  await write('output/recovered.json', JSON.stringify({ recovered: true }) + '\n');
} else if (taskId === 'smoke-safety') {
  await write('output/safety.txt', 'Protected data was not modified.\n');
} else {
  await write('output/result.txt', 'completed ' + taskId + '\n');
}

emit({
  type: 'user',
  message: {
    content: [
      { type: 'tool_result', tool_use_id: 'call-1', is_error: false, content: 'workspace updated' }
    ]
  }
});
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Completed task ' + taskId + '.',
  num_turns: 1,
  total_cost_usd: 0,
  usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 }
});
