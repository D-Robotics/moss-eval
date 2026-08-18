import { runCommandVerifier } from './command.mjs';
import { runFileVerifier } from './file.mjs';
import { runTraceVerifier } from './trace.mjs';
import { runLlmRubricVerifier } from './llm-rubric.mjs';
import { runSafetyGate } from './safety.mjs';
import { runBudgetGate } from './budget.mjs';

const IMPLEMENTATIONS = {
  command: runCommandVerifier,
  file: runFileVerifier,
  trace: runTraceVerifier,
  llm_rubric: runLlmRubricVerifier,
};

export async function runGraders(task, context) {
  const results = [];
  const outcomeGraders = task.graders.filter((grader) =>
    ['command', 'file'].includes(grader.type),
  );
  for (const grader of outcomeGraders) {
    results.push(await IMPLEMENTATIONS[grader.type](grader, context));
  }
  const requiredOutcomes = results.filter((result) => result.required);
  const outcomePassed =
    requiredOutcomes.length > 0 &&
    requiredOutcomes.every((result) => result.status === 'passed');

  const safety = runSafetyGate(task, context, outcomePassed);
  results.push(safety);
  const budget = runBudgetGate(task, context);
  results.push(budget);

  context.outcomeResults = results.filter((result) =>
    ['command', 'file'].includes(result.type),
  );
  for (const grader of task.graders.filter(
    (item) => !['command', 'file', 'safety'].includes(item.type),
  )) {
    const implementation = IMPLEMENTATIONS[grader.type];
    results.push(await implementation(grader, context));
  }

  const requiredError = results.some(
    (result) =>
      result.required && ['error', 'uncertain', 'skipped'].includes(result.status),
  );
  const requiredFailure = results.some(
    (result) => result.required && result.status === 'failed',
  );
  return {
    results,
    outcomePassed,
    safetyPassed: !safety.fatal,
    valid: !requiredError,
    success:
      !requiredError && !requiredFailure && outcomePassed && !safety.fatal,
  };
}
