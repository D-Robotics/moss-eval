import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseRun, explainMetric, friendlyError, friendlyFailure, groupTrialsByTask, guardStep, inferApiProtocol, releasePresentation, validateModelInputs, validateSourceSelection, workflowReadiness } from '../../app/renderer/workflow.mjs';

test('guided workflow readiness follows canonical source and prepared target state', () => {
  assert.deepEqual(workflowReadiness({}), { source:true, configure:false, live:false });
  const selected={sourceRecord:{id:'source'},inspection:{status:'detected'}};
  assert.deepEqual(workflowReadiness(selected), { source:true, configure:true, live:false });
  assert.deepEqual(workflowReadiness({...selected,prepared:{target:{target_fingerprint:'a'}}}), { source:true, configure:true, live:true });
});

test('navigation guards explain and redirect unmet prerequisites', () => {
  assert.deepEqual(guardStep('configure',{}),{allowed:false,redirect:'source',message:'请先选择并分析要评测的 Agent',focus_id:'source-url'});
  assert.deepEqual(guardStep('live',{sourceRecord:{},inspection:{}}),{allowed:false,redirect:'configure',message:'请先完成评测配置并准备评测环境',focus_id:'prepare-target'});
  assert.equal(guardStep('live',{prepared:{target:{}}}).allowed,true);
});

test('guided validation returns corrective field-specific messages', () => {
  assert.equal(validateSourceSelection({mode:'local',directory:''}).message,'请先选择电脑上的 Agent 项目文件夹');
  assert.equal(validateSourceSelection({mode:'github',url:'not-a-repository'}).field,'source-url');
  assert.equal(validateModelInputs({model:'m',baseUrl:'https://api.example.com',apiKey:'',networkApproved:true}).field,'model-api-key');
  assert.equal(validateModelInputs({model:'m',baseUrl:'https://api.example.com',apiKey:'secret',networkApproved:false}).field,'approve-runtime-network');
  assert.equal(friendlyError({code:'MODEL_CONNECTION_FAILED'}),'模型服务连接失败，请检查 Base URL、API Key 和模型名后重试');
  assert.equal(friendlyError({code:'MODEL_CONNECTION_FAILED',message:'连接失败，HTTP 401。请检查 API Key'}),'连接失败，HTTP 401。请检查 API Key');
});

test('API protocol is inferred without asking for a vendor', () => {
  assert.equal(inferApiProtocol('https://ai-api.d-robotics.cc/v1'),'openai-compatible');
  assert.equal(inferApiProtocol('https://api.anthropic.com'),'anthropic');
  assert.equal(inferApiProtocol('https://custom.example.com','anthropic'),'anthropic');
});

test('failure causes and advanced metrics have plain Chinese explanations', () => {
  assert.equal(friendlyFailure('budget_exceeded').title,'超出资源上限');
  assert.match(friendlyFailure('safety_violation').description,/安全规则/);
  assert.match(friendlyFailure('unknown_reason').description,/unknown_reason/);
  assert.match(explainMetric('pass_at_k'),/至少一次成功/);
  assert.match(explainMetric('pass_pow_k'),/每次都成功/);
  assert.match(explainMetric('tool_precision'),/符合任务预期/);
});

test('systematic invalid executions are presented as an inconclusive harness failure', () => {
  const invalid = [1, 2, 3].map((replicate) => ({
    task:{id:`code-00${replicate}`,title:'Task',category:'coding-repository'},agent:'moss',replicate,
    status:'invalid',valid:false,success:false,outcome_passed:false,safety_passed:true,failure_category:'environment_error',
  }));
  const diagnosis=diagnoseRun({trials:invalid});
  assert.equal(diagnosis.validity,'inconclusive');
  assert.equal(diagnosis.invalid_executions,3);
  assert.match(diagnosis.description,/环境或配置问题无效/);
  assert.equal(friendlyFailure('environment_error').title,'评测环境无效');
});

test('legacy MOSS entrypoint failures are re-presented as invalid without mutating artifacts', () => {
  const legacy={
    task:{id:'code-003',title:'Fix addition',category:'coding-repository'},agent:'moss',replicate:1,
    status:'failed',valid:true,success:false,outcome_passed:false,safety_passed:true,failure_category:'agent_reasoning_error',
    process:{exit_code:127,duration_ms:575,args:['MOSS_CLI_AUTO_APPROVE=1']},metrics:{tool_call_count:0,changed_files:0},
  };
  const diagnosis=diagnoseRun({trials:[legacy]});
  assert.equal(diagnosis.validity,'inconclusive');
  assert.equal(diagnosis.invalid_executions,1);
  assert.deepEqual(diagnosis.failure_counts,{environment_error:1});
  assert.equal(diagnosis.tasks[0].valid,0);
  assert.equal(legacy.valid,true);
  assert.equal(legacy.failure_category,'agent_reasoning_error');
});

test('release status distinguishes a passing run from a publishable claim', () => {
  const missing=releasePresentation(null);assert.equal(missing.eligible,false);assert.match(missing.title,/开发评测/);
  const blocked=releasePresentation({eligible:false,status:'development-only',blockers:['hidden_oracle-gate-not-passed','human_review-gate-not-passed']});
  assert.equal(blocked.blockers.length,2);assert.match(blocked.blockers[0],/隐藏/);assert.match(blocked.description,/不等于/);
});

test('run diagnostics group repeated trials and identify an old MOSS approval block', () => {
  const blockedTrial=(taskId,replicate)=>({
    task:{id:taskId,title:`Task ${taskId}`,category:'coding-repository'},agent:'moss',replicate,status:'failed',valid:true,success:false,failure_category:'budget_exceeded',
    process:{args:['docker','run','MOSS_EVAL_TASK_ID='+taskId]},fingerprint:{adapter:'moss'},
    graders:[{id:'deterministic-outcome',details:{stderr_tail:`Error: ENOENT, open '/workspace/results/${taskId}.json'`}}],
  });
  const trials=[blockedTrial('code-001',1),blockedTrial('code-001',2),blockedTrial('code-002',1),blockedTrial('code-002',2)];
  const groups=groupTrialsByTask(trials);
  assert.equal(groups.length,2);assert.equal(groups[0].attempts,2);assert.equal(groups[0].outcomes,0);assert.equal(groups[0].main_failure,'budget_exceeded');
  const diagnosis=diagnoseRun({trials});
  assert.equal(diagnosis.validity,'inconclusive');assert.equal(diagnosis.systematic_approval_block,true);
  assert.equal(diagnosis.sentence,'2 条任务，每条最多 2 次，共 4 次执行');
  assert.match(diagnosis.title,/不能用于判断 Agent 能力/);
});

test('authorized MOSS failures remain capability evidence', () => {
  const trial={task:{id:'code-001',title:'Task'},agent:'moss',replicate:1,status:'failed',valid:true,success:false,outcome_passed:true,safety_passed:true,failure_category:'budget_exceeded',process:{args:['--env','MOSS_CLI_AUTO_APPROVE=1']},graders:[{id:'deterministic-outcome',status:'passed',details:{}}]};
  const diagnosis=diagnoseRun({trials:[trial]});
  assert.equal(diagnosis.validity,'valid');assert.equal(diagnosis.outcome_passed_tasks,1);assert.equal(diagnosis.passed_executions,0);
});
