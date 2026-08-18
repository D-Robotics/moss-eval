# MOSS Native Telemetry

moss-eval 在 Agent 进程退出后读取 Trial 工作区中的 MOSS 原生埋点，并与实时 Stream JSON/ACP Trace 合并。该能力同时适用于 Release Track 和 Source Track，不修改 MOSS 源码。

## 数据源与权威边界

| 数据 | 首选来源 | 用途 |
|---|---|---|
| 实时进度、跨 Agent 兼容 | Stream JSON / ACP | 终端面板与通用 Trace |
| 工具调用、结果、Outcome、耗时 | `.moss/sessions/*.jsonl` | 工具过程指标 |
| 模型调用和 Token | `.moss/llm-usage.jsonl` | Budget 与效率指标 |
| 最终结果和安全 | 外部 Grader | Trial 成败 |

原生遥测缺失时继续使用通用 Trace。原生遥测不一致时，`telemetry_valid=false`，相关过程指标不进入可信聚合，但 Outcome 与 Safety 保持外部 Grader 的独立结论。

## Trial 产物

- `native-telemetry.json`：允许字段组成的工具和 Usage 明细；
- `telemetry-summary.json`：数据源可用性、计数、Token、工具耗时和一致性；
- `telemetry-mismatches.json`：解析错误、调用数量/ID或 Token 不一致。

Session 原文可能包含 thinking。公共派生产物只遍历 `tool_use` 和 `tool_result`，不会复制消息正文、thinking 或 checkpoint；参数、结果和错误经过 Secret 脱敏和长度限制。原始 Trial Workspace 仍应按敏感调试产物管理，不应直接发布。

## 工具指标

有原生数据时，Trial 可报告：

- 调用总数、按工具分类数量；
- 成功、错误、未完成调用；
- 重复调用；
- 工具耗时记录数、总耗时、P50/P95；
- 模型调用数和 Token/Cache Token；
- Stream/Session/Usage 一致性。

工具调用“正确性”需要 Task Oracle，不能仅由埋点推断。任务可选择声明：

```json
{
  "tool_expectations": {
    "expected": ["edit_file", "run_tests"],
    "required_any": ["edit_file", "apply_patch"],
    "required_all": ["run_tests"],
    "forbidden": ["outside_write"],
    "max_calls": 20,
    "must_verify_after_mutation": true,
    "mutation_tools": ["edit_file", "apply_patch"],
    "verification_tools": ["run_tests", "verify_fix"]
  }
}
```

声明后计算 Selection Precision、Recall、F1 和策略违规；未声明时这些值为 `null`。默认不约束完整顺序，避免排斥合法替代路径。

## OpenTelemetry

MOSS 已实现工具、LLM 和 Session 的 OTel Span/Metrics。当前版本不强制启用，因为 CLI 的本地 Trace 与 OTLP 开关耦合；Session/Usage 已能无外部服务地提供确定性数据。后续可以通过受控 Collector 增加 Span 树和跨服务关联。
