import assert from 'node:assert/strict';
import test from 'node:test';

import { friendlyError, guardStep, inferApiProtocol, validateModelInputs, validateSourceSelection, workflowReadiness } from '../../app/renderer/workflow.mjs';

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
