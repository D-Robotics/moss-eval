export const PRIMARY_STEPS = Object.freeze([
  Object.freeze({ id: 'source', number: 1, label: '选择 Agent' }),
  Object.freeze({ id: 'configure', number: 2, label: '配置评测' }),
  Object.freeze({ id: 'live', number: 3, label: '运行与结果' }),
]);

export const SECONDARY_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'history', label: '历史记录' }),
  Object.freeze({ id: 'report', label: '报告与对比' }),
]);

const FAILURE_PRESENTATION = Object.freeze({
  budget_exceeded: Object.freeze({ title: '超出资源上限', description: 'Agent 使用的 Token、工具调用次数或执行时间超过了这条任务的限制。', action: '展开任务详情确认具体超限项，并检查是否存在重复探索。' }),
  safety_violation: Object.freeze({ title: '安全或真实性检查未通过', description: '输出、文件修改或工具行为触发了任务的硬性安全规则。', action: '查看安全断言详情，区分真实风险与表述误判后再处理。' }),
  outcome_failed: Object.freeze({ title: '任务结果未通过', description: 'Agent 完成了执行，但最终文件、答案或环境状态没有满足确定性验收条件。', action: '查看验收失败详情和期望结果。' }),
  configuration_error: Object.freeze({ title: '运行配置有问题', description: 'Agent 尚未获得有效模型、运行环境或必要授权。', action: '返回配置页修正提示项后重新运行。' }),
  environment_error: Object.freeze({ title: '评测环境无效', description: 'Agent 没有成功启动，通常是镜像、启动入口或运行依赖存在问题；这不代表 Agent 能力未通过。', action: '重新准备评测环境；如果仍然出现，请查看启动错误并修复 Adapter。' }),
  provider_error: Object.freeze({ title: '模型服务调用失败', description: '模型网关返回错误或连接中断。', action: '检查 Base URL、API Key、模型名和网络授权。' }),
  tool_error: Object.freeze({ title: '工具执行失败', description: 'Agent 调用的工具格式错误、参数错误或执行失败。', action: '查看工具轨迹以定位具体调用。' }),
  invalid_output: Object.freeze({ title: '输出格式无效', description: 'Agent 输出无法被评测器解析或缺少必填字段。', action: '查看任务契约与原始输出。' }),
  timeout: Object.freeze({ title: '执行超时', description: '任务在时间上限前没有结束。', action: '检查卡住的工具、重试循环或提高合理的任务时限。' }),
  cancelled: Object.freeze({ title: '已取消', description: '这次执行被用户或系统取消。', action: '需要结果时重新运行。' }),
  unexpected_error: Object.freeze({ title: '评测器异常', description: '评测执行遇到未预期的内部错误。', action: '查看技术详情中的错误信息。' }),
});

const METRIC_PRESENTATION = Object.freeze({
  outcome_pass_rate: '执行通过率：所有有效执行中，最终结果满足验收条件的比例。',
  trial_success_rate: '完整通过率：最终结果、安全规则和必需检查全部通过的执行比例。',
  pass_at_1: 'Pass@1：每条任务只看第一次尝试时的通过比例。',
  pass_at_k: 'Pass@k：每条任务尝试 k 次，只要至少一次成功就算通过，反映能力上限。',
  pass_pow_k: 'Pass^k：每条任务尝试 k 次，必须每次都成功，反映稳定性。',
  valid_trial_rate: '有效执行率：真正进入评分、没有因环境或配置问题作废的执行比例。',
  safety_violation_rate: '安全违规率：触发硬性安全或真实性规则的有效执行比例，越低越好。',
  recovery_success_rate: '异常恢复成功率：面对超时、鉴权失败等故障时正确处理的任务比例。',
  tool_precision: '工具精确率：已调用工具中，符合任务预期的调用比例。',
  tool_recall: '工具召回率：任务要求的工具行为中，Agent 实际覆盖的比例。',
  tool_f1: '工具 F1：工具精确率和召回率的综合平衡分数。',
  telemetry: '遥测覆盖：有多少执行提供了可用于诊断的完整轨迹数据。',
});

export function friendlyFailure(category) {
  const key=String(category||'outcome_failed');
  return FAILURE_PRESENTATION[key] || Object.freeze({ title: '未通过', description: `评测记录的技术原因是 ${key}。`, action: '展开技术详情查看 grader 和轨迹证据。' });
}

export function explainMetric(metric) {
  return METRIC_PRESENTATION[String(metric||'')] || '这是高级评测指标；展开原始 summary 可查看数值、分母和置信区间。';
}

const RELEASE_BLOCKER_LABELS = Object.freeze({
  'adapter_qualification-gate-not-passed': 'Agent 适配器资格检查未完成',
  'cross_agent-gate-not-passed': '尚未完成三种独立 Agent 的可比试跑',
  'hidden_oracle-gate-not-passed': '尚未运行私有隐藏验收规则',
  'human_review-gate-not-passed': '尚缺独立数据审核人与发布负责人签署',
  'telemetry-gate-not-passed': '过程轨迹完整性尚未通过',
  'security-gate-not-passed': '密钥扫描或验收隔离尚未通过',
  'regression-gate-not-passed': '回归门禁尚未通过',
  'packaged_client-gate-not-passed': '安装版 Windows 客户端验证尚未通过',
});

export function releasePresentation(decision) {
  if (!decision) return Object.freeze({ eligible:false, status:'development-only', title:'这是开发评测结果', description:'本次结果没有附带正式发布门禁证据，适合调试和回归，不应作为公开性能结论。', blockers:Object.freeze(['未附带发布门禁证据']), dataset_digest:null, protocol_digest:null });
  const blockers=(decision.blockers||[]).map((value)=>RELEASE_BLOCKER_LABELS[value]||String(value));
  return Object.freeze({ eligible:decision.eligible===true, status:decision.status||'development-only', title:decision.eligible?'正式发布门禁已通过':'这是开发评测结果', description:decision.eligible?'数据、隐藏验收、独立审核、安全和客户端验证均有完整证据。':`仍有 ${blockers.length} 项正式发布条件未满足；任务通过不等于评测体系已可对外发布。`, blockers:Object.freeze(blockers), dataset_digest:decision.dataset_digest||decision.gates?.corpus?.evidence||null, protocol_digest:decision.protocol_digest||null });
}

function receiptMissing(trial) {
  return (trial?.graders||[]).some((grader)=>grader.id==='deterministic-outcome' && /ENOENT[\s\S]*results[\\/]/i.test(String(grader.details?.stderr_tail||'')));
}

function isMossTrial(trial) {
  return trial?.agent==='moss' || trial?.fingerprint?.adapter==='moss' || trial?.fingerprint?.prepared_target?.adapter?.id==='moss';
}

function hasAutoApproval(trial) {
  return (trial?.process?.args||[]).some((item)=>String(item)==='MOSS_CLI_AUTO_APPROVE=1');
}

export function groupTrialsByTask(trials = []) {
  const groups=new Map();
  for(const trial of trials){
    const id=trial?.task?.id||'unknown-task';
    if(!groups.has(id))groups.set(id,{id,title:trial?.task?.title||id,category:trial?.task?.category||'—',attempts:0,outcomes:0,passed:0,safety_passed:0,valid:0,failures:{},trials:[]});
    const group=groups.get(id);group.attempts+=1;group.outcomes+=trial?.outcome_passed?1:0;group.passed+=trial?.success?1:0;group.safety_passed+=trial?.safety_passed===false?0:1;group.valid+=trial?.valid===false?0:1;group.trials.push(trial);
    if(!trial?.success){const category=trial?.failure_category||'outcome_failed';group.failures[category]=(group.failures[category]||0)+1;}
  }
  return [...groups.values()].map((group)=>{
    const mainFailure=Object.entries(group.failures).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||null;
    return Object.freeze({...group,failures:Object.freeze({...group.failures}),trials:Object.freeze([...group.trials]),main_failure:mainFailure});
  });
}

export function diagnoseRun(run = {}) {
  const trials=run?.trials||[];
  const tasks=groupTrialsByTask(trials);
  const passedExecutions=trials.filter((trial)=>trial?.success).length;
  const outcomePassedExecutions=trials.filter((trial)=>trial?.outcome_passed).length;
  const safetyPassedExecutions=trials.filter((trial)=>trial?.safety_passed!==false).length;
  const passedTasks=tasks.filter((task)=>task.passed>0).length;
  const outcomePassedTasks=tasks.filter((task)=>task.outcomes>0).length;
  const invalidExecutions=trials.filter((trial)=>trial?.valid===false).length;
  const failureCounts={};
  for(const trial of trials)if(!trial?.success){const category=trial?.failure_category||'outcome_failed';failureCounts[category]=(failureCounts[category]||0)+1;}
  const missingWithoutApproval=trials.filter((trial)=>isMossTrial(trial)&&receiptMissing(trial)&&!hasAutoApproval(trial)).length;
  const systematicApprovalBlock=trials.length>=2 && missingWithoutApproval>=Math.ceil(trials.length*0.6);
  const repetitions=tasks.length?Math.max(...tasks.map((task)=>task.attempts)):0;
  let validity='valid',title='本轮可以用于判断 Agent 能力',description='评测环境和验收链路没有发现系统性阻断，可以结合任务结果分析能力。',action='优先查看未通过任务的主要原因和验收详情。';
  if(!trials.length){validity='incomplete';title='本轮没有可分析的执行结果';description='评测可能尚未开始、被中断，或 artifacts 不完整。';action='返回运行页确认状态，必要时重新开始。';}
  else if(systematicApprovalBlock){validity='inconclusive';title='本轮不能用于判断 Agent 能力';description=`${missingWithoutApproval}/${trials.length} 次执行缺少结果文件，而且 MOSS 没有获得隔离副本内的写入与命令授权。这是评测接入问题，不代表 Agent 的真实通过率。`;action='返回配置页勾选“允许 Agent 修改评测副本并运行测试”，然后重新运行。';}
  else if(invalidExecutions>=Math.ceil(trials.length*0.6)){validity='inconclusive';title='本轮不能用于判断 Agent 能力';description=`${invalidExecutions}/${trials.length} 次执行因环境或配置问题无效，Agent 没有获得可评分的运行机会。`;action='先修复主要环境错误并重新准备评测环境，再重新运行。';}
  return Object.freeze({
    validity,title,description,action,systematic_approval_block:systematicApprovalBlock,
    task_count:tasks.length,repetitions,total_executions:trials.length,invalid_executions:invalidExecutions,outcome_passed_executions:outcomePassedExecutions,outcome_passed_tasks:outcomePassedTasks,safety_passed_executions:safetyPassedExecutions,passed_executions:passedExecutions,passed_tasks:passedTasks,
    tasks:Object.freeze(tasks),failure_counts:Object.freeze(failureCounts),
    sentence:`${tasks.length} 条任务，每条最多 ${repetitions} 次，共 ${trials.length} 次执行`,
  });
}

export function workflowReadiness(state = {}) {
  const sourceReady = Boolean(state.sourceRecord && state.inspection);
  const environmentReady = Boolean(state.prepared?.target);
  return Object.freeze({ source: true, configure: sourceReady, live: environmentReady || Boolean(state.activeRun) });
}

export function guardStep(target, state = {}) {
  const readiness = workflowReadiness(state);
  if (target === 'configure' && !readiness.configure) {
    return Object.freeze({ allowed: false, redirect: 'source', message: '请先选择并分析要评测的 Agent', focus_id: state.sourceMode === 'local' ? 'choose-local-source' : 'source-url' });
  }
  if (target === 'live' && !readiness.live) {
    if (!readiness.configure) return Object.freeze({ allowed: false, redirect: 'source', message: '请先选择并分析要评测的 Agent', focus_id: state.sourceMode === 'local' ? 'choose-local-source' : 'source-url' });
    return Object.freeze({ allowed: false, redirect: 'configure', message: '请先完成评测配置并准备评测环境', focus_id: 'prepare-target' });
  }
  return Object.freeze({ allowed: true, redirect: target, message: null, focus_id: null });
}

export function validateSourceSelection({ mode, url, directory }) {
  if (mode === 'local' && !String(directory || '').trim()) return Object.freeze({ field: 'source-local', message: '请先选择电脑上的 Agent 项目文件夹' });
  if (mode !== 'local' && !String(url || '').trim()) return Object.freeze({ field: 'source-url', message: '请输入公开 GitHub 仓库地址' });
  if (mode !== 'local' && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(String(url).trim())) {
    return Object.freeze({ field: 'source-url', message: '请输入仓库主页地址，例如 https://github.com/D-Robotics/moss' });
  }
  return null;
}

export function validateModelInputs({ model, baseUrl, apiKey, networkApproved }) {
  if (!String(baseUrl || '').trim()) return Object.freeze({ field: 'model-base-url', message: '请输入模型服务的 Base URL' });
  if (!String(apiKey || '').trim()) return Object.freeze({ field: 'model-api-key', message: '请输入 API Key。它只用于本次评测，不会保存' });
  if (!String(model || '').trim()) return Object.freeze({ field: 'model-name', message: '请输入要使用的模型名称' });
  if (!networkApproved) return Object.freeze({ field: 'approve-runtime-network', message: '请允许本次评测访问模型公网，否则无法连接模型服务' });
  return null;
}

export function inferApiProtocol(baseUrl, override = 'auto') {
  if (override === 'anthropic') return 'anthropic';
  if (override === 'openai-compatible') return 'openai-compatible';
  try {
    const hostname = new URL(String(baseUrl || '').trim()).hostname.toLowerCase();
    return hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com') ? 'anthropic' : 'openai-compatible';
  } catch {
    return 'openai-compatible';
  }
}

export function friendlyError(error, fallback = '操作没有完成，请检查后重试') {
  const code = String(error?.code || '');
  if (code === 'MODEL_CONNECTION_FAILED' && /HTTP\s+\d{3}/i.test(String(error?.message || ''))) return String(error.message);
  const messages = {
    UNSUPPORTED_SOURCE_URL: '这个地址不是受支持的公开 GitHub 仓库，请检查后重试',
    GITHUB_REF_NOT_FOUND: '没有找到指定的分支、标签或 Commit，请检查高级设置',
    SOURCE_UNREADABLE: '无法读取这个项目文件夹，请检查路径和访问权限',
    SOURCE_NOT_DIRECTORY: '请选择一个项目文件夹，而不是单个文件',
    SOURCE_FILE_TOO_LARGE: '项目中存在超出评测限制的大文件，请移除后重试',
    SOURCE_TOTAL_TOO_LARGE: '项目体积超出评测限制，请精简后重试',
    RUNTIME_NETWORK_NOT_AUTHORIZED: '请允许本次评测访问模型公网，否则无法连接模型服务',
    AGENT_ACTIONS_NOT_AUTHORIZED: '请允许 Agent 在隔离评测副本中修改文件并运行测试；原项目不会被修改',
    MODEL_CONFIGURATION_INVALID: '模型配置不完整，请检查 Base URL、API Key 和模型名',
    MODEL_CONNECTION_FAILED: '模型服务连接失败，请检查 Base URL、API Key 和模型名后重试',
  };
  return messages[code] || String(error?.message || fallback).replace(/^[A-Z0-9_]+:\s*/, '') || fallback;
}
