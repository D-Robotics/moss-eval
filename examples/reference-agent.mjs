#!/usr/bin/env node
import { materializeReferenceOutcome } from '../src/core/calibration.mjs';

const taskId = process.env.MOSS_EVAL_TASK_ID;
const workspace = process.env.MOSS_EVAL_WORKSPACE || process.cwd();
if (!taskId) throw new Error('MOSS_EVAL_TASK_ID is required');

await materializeReferenceOutcome(taskId, workspace);
process.stdout.write(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Reference outcome completed for ' + taskId + '.',
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  total_cost_usd: 0
}) + '\n');
