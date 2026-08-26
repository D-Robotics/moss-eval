const BLOCKERS = {
  'adapter_qualification-gate-not-passed': '还缺少 3 个同协议、同隔离环境的合格 Agent 适配器',
  'cross_agent-gate-not-passed': '还没有完成至少 3 个独立 Agent 家族的可比评测',
  'hidden_oracle-gate-not-passed': '还没有真实私有隐藏验收集及通过回执',
  'human_review-gate-not-passed': '还没有两位职责分离的独立人工签署',
  'regression-gate-not-passed': '还没有两轮稳定的回归对比证据',
  'packaged_client-gate-not-passed': '还没有干净 Windows 环境的安装包验收回执',
};

function percent(metric) {
  return Number.isFinite(metric?.value) ? `${(metric.value * 100).toFixed(1)}% (${metric.successes}/${metric.total})` : '不可计算';
}

function duration(value) {
  return Number.isFinite(value) ? `${(value / 1000).toFixed(2)} 秒` : '无数据';
}

export function explainRunSummary(summary, releaseDecision = null) {
  const agent = summary?.agents?.[0] || null;
  const source = agent || summary || {};
  const k = Number(source.k || summary?.k || 1);
  const blockers = (releaseDecision?.blockers || []).map((item) => BLOCKERS[item] || item);
  const lines = [
    `评测状态：${releaseDecision?.eligible ? '正式发布门禁通过' : '开发评测结果'}`,
    `Agent：${source.agent || '未知'}；任务 ${source.tasks?.length || summary?.trial_count || 0} 条；Trial ${summary?.trial_count || 0} 次`,
    `完整通过率：${percent(source.trial_success_rate)}（结果、预算、安全和运行有效性全部通过）`,
    `结果正确率：${percent(source.outcome_pass_rate)}（只看最终输出或最终环境状态）`,
    `有效 Trial 率：${percent(source.valid_trial_rate)}（基础设施和轨迹证据可用）`,
    `安全违规率：${percent(source.safety_violation_rate)}（越低越好）`,
    `延迟：P50 ${duration(source.latency_ms?.p50)}；P95 ${duration(source.latency_ms?.p95)}`,
    `成本：${Number.isFinite(source.cost?.total_usd) ? `USD ${source.cost.total_usd.toFixed(6)}` : '无数据'}；Token ${source.tokens?.total ?? '无数据'}`,
    `工具轨迹：${source.tools?.trusted_trial_count ?? 0}/${summary?.trial_count || 0} 个 Trial 可信，共 ${source.tools?.total_calls ?? 0} 次调用，执行失败率 ${Number.isFinite(source.tools?.execution_failure_rate) ? `${(source.tools.execution_failure_rate * 100).toFixed(1)}%` : '不可计算'}`,
  ];
  if (k <= 1) lines.push('稳定性说明：本轮每条任务只尝试 1 次，pass@k 和 pass^k 等同于 pass@1，不能说明重复运行稳定性。');
  else lines.push(`稳定性：pass@${k} ${percent(source.pass_at_k)}；pass^${k} ${percent(source.pass_pow_k)}。`);
  if (blockers.length) lines.push('正式发布仍缺：', ...blockers.map((item, index) => `${index + 1}. ${item}`));
  return { schema_version: '1.0', status: releaseDecision?.eligible ? 'release-eligible' : 'development-only', lines, blockers };
}
