# Task 编写指南

任务文件名使用 `*.task.json`。单个文件可以是一个 Task、Task 数组，或 `{ "defaults": ..., "tasks": [...] }`。`defaults.instruction_suffix` 会附加到每个任务指令，适合统一 Artifact 契约。

## 最低要求

- ID 和 Version 永不复用到不同语义；
- 至少一个 `required: true` 的 `command` 或 `file` Outcome Grader；
- P0 安全任务必须有 Fatal Assertions；
- Fixture 不含密钥、`.git` 或 `node_modules`；
- Oracle 检查真实状态，不检查 Agent 自称成功；
- 不限制合法的工具顺序；
- 任务、Grader 和 Fixture 变更必须提升 Task Version。

## Grader 选择

优先顺序为 Command、File、Trace、LLM Rubric。代码任务运行测试或检查文件状态；Research 分开检查事实、来源、日期和引用；Browser 检查页面/后端状态；Device 检查模拟器或硬件最终状态。Trace 只约束审批、安全或明确协议。

## 工具调用 Oracle

只有业务上确实存在工具选择约束时才声明 `tool_expectations`。支持 `expected`、`required_any`、`required_all`、`forbidden`、`max_calls`、`must_verify_after_mutation`、`mutation_tools` 和 `verification_tools`。`expected` 用于 Precision/Recall/F1；其他字段用于策略检查。

不要复制一次成功运行的完整工具序列作为 Oracle，也不要要求固定顺序。优先表达“至少使用一种安全修改工具”“禁止越界写入”“修改后必须验证”等不变量。未声明 Oracle 的任务不会伪造 Tool F1。

示例见 [MOSS 原生遥测](NATIVE_TELEMETRY.md)。

## 安全

正式任务默认使用 Docker。Local Runner 只接受显式 `--allow-local`，且只能运行可信 Task。`network=allowlist` 在没有外部网络策略后端时会失败，不会退化为开放网络。

可用 Fatal Assertion：`forbidden_output_regex`、`forbidden_tool`、`no_secret_leak`、`forbidden_file_change`、`require_approval_for_tool`、`no_false_success_claim`。

## 晋级流程

Candidate Task 必须依次完成参考解、Grader 正反例测试、至少一名领域人员审核、替代路径检查、污染风险标记，才能进入 Regression Suite。

核心任务可运行 `npm run calibrate`。命令会执行确定性参考解，并验证缺失 Receipt、自引用 Evidence 和 Protected File Mutation 三类反例都无法通过 Oracle。任何误报或漏报都会使 CI 失败。
