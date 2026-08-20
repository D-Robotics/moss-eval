import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadTasks } from '../../src/core/task-loader.mjs';
import { validateTask } from '../../src/core/task-validator.mjs';

const root = path.resolve(import.meta.dirname, '../..');

test('core registry loads exactly 50 versioned tasks with required outcomes', async () => {
  const tasks = await loadTasks([path.join(root, 'taskpacks/core')]);
  assert.equal(tasks.length, 50);
  assert.equal(new Set(tasks.map((task) => task.id)).size, 50);
  assert.ok(tasks.every((task) => task.graders.some((g) => g.required && ['command', 'file'].includes(g.type))));
  assert.ok(tasks.filter((task) => task.category === 'permissions-security').every((task) => task.fatal_assertions.length > 0));
});

test('core registry preserves the specified category distribution', async () => {
  const tasks = await loadTasks([path.join(root, 'taskpacks/core')]);
  const counts = Object.fromEntries(
    [...new Set(tasks.map((task) => task.category))].map((category) => [
      category,
      tasks.filter((task) => task.category === category).length,
    ]),
  );
  assert.deepEqual(counts, {
    'installation-auth-runtime': 4,
    'coding-repository': 12,
    'long-context-memory': 8,
    'mcp-skills-subagents': 6,
    'permissions-security': 8,
    'shell-network-recovery': 5,
    'web-browser': 4,
    'robotics-device': 3,
  });
});

test('task validator accepts set-based tool expectations and rejects invalid declarations', async () => {
  const [task] = await loadTasks([path.join(root, 'taskpacks/core')]);
  assert.doesNotThrow(() => validateTask({
    ...task,
    tool_expectations: {
      expected: ['read_file', 'run_tests'],
      required_any: ['edit_file', 'apply_patch'],
      forbidden: ['outside_write'],
      max_calls: 10,
      must_verify_after_mutation: true,
    },
  }));
  assert.throws(
    () => validateTask({ ...task, tool_expectations: { required_all: 'read_file' } }),
    /tool_expectations.required_all/,
  );
});

test('task validator preserves structured LLM rubrics and rejects string rubrics', async () => {
  const [task] = await loadTasks([path.join(root, 'taskpacks/core')]);
  const rubric = {
    version: 'quality-v1',
    criteria: [{ id: 'clarity', description: 'Response is clear', weight: 1 }],
    score_scale: { min: 0, max: 1 },
  };
  const withRubric = {
    ...task,
    graders: [
      ...task.graders,
      {
        id: 'quality', type: 'llm_rubric', version: '1', required: false,
        timeout_seconds: 10, rubric,
      },
    ],
  };
  assert.doesNotThrow(() => validateTask(withRubric));
  assert.deepEqual(withRubric.graders.at(-1).rubric, rubric);
  assert.throws(
    () => validateTask({
      ...withRubric,
      graders: withRubric.graders.map((grader) =>
        grader.id === 'quality' ? { ...grader, rubric: 'clarity' } : grader),
    }),
    /requires an object rubric/,
  );
});
