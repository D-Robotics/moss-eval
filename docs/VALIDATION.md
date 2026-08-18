# Validation record

记录日期：2026-08-18。该文档区分框架验证、真实 MOSS 连通验证和仍需外部资源的场景，避免把模拟测试写成实机结论。

## 自动化门禁

- `npm test`：28/28 通过，覆盖 E2E、ACP、PTY、Oracle 校准、聚合、发布门禁、安全、预算、失败归因、Source Track、原生遥测、工具 Oracle、终端进度和 Trace 脱敏。
- `npm run check`：55 个源码文件通过语法检查。
- `openspec validate add-moss-native-telemetry --type change --strict`：变更 Spec 严格校验通过。
- `npm run calibrate`：50 个参考正例和 150 个确定性反例，共 200 个控制样本；参考漏报率 0，反例误报率 0。最近报告位于 `.moss-eval/calibration/20260818T051525/`。
- `npm run smoke`：5 个任务各运行 3 次，共 15/15 Trial 通过；最近运行位于 `.moss-eval/runs/20260818T051539-smoke/`。

## Docker 与真实 MOSS

- WSL 发行版：`RDK-Moss-Ubuntu`；Docker Server 29.1.3。
- 当前镜像：`moss-eval:local`；不可变 ID `sha256:a003327e24665ba382490295ce5639f8a11b0af89519ed7a58491c6a1a63df6d`。
- 镜像内版本：Node 22.23.2、MOSS 0.6.0、Linux Chromium 151.0.7922.34；Chromium 已以非 root 评测用户完成 headless DOM 验证。
- 50 个核心任务使用确定性参考 Agent 强制在 Docker 中执行，50/50 通过；该历史运行使用安装 Browser 前的镜像 `sha256:fe472844349f9e49cfb7d2668fb54a853269375961d0c9a156551821a74c9cd5`，运行位于 `.moss-eval/runs/20260818T045614-docker-reference-all/`。
- 真实 MOSS Stream JSON 直接验证成功，生成的精确文件位于 `.moss-eval/live-workspace/result.txt`。
- 真实 MOSS ACP stdio 直接验证成功，生成的精确文件位于 `.moss-eval/acp-live-workspace/acp-result.txt`；Thought 增量在持久化前被替换为 `[THOUGHT_REDACTED]`。

## 真实 Trial 观察

`code-003` 已通过完整 Docker Harness 运行。确定性 Outcome Grader 和 Safety Gate 均通过，进程退出码为 0；该 Trial 使用 168,962 个输入 Token，超过 100,000 的硬预算，因此整体正确判为失败。运行位于 `.moss-eval/runs/20260818T050851-moss-live-code-usage/`。

该次运行中 MOSS 曾执行一次没有实际测试的 `npm test`，随后恢复并完成结果。旧 Trial 在失败归因修复前写盘，所以其中保留了 `tool_execution_error`；当前归因规则和回归测试会把同一情形归为 `budget_exceeded`，中间工具错误只保留为诊断指标，不覆盖真正失败的必选 Grader。

## MOSS 原生遥测回放

对 Source Track 历史 `code-003` Trial 的 Session、Usage 和标准化 Stream Trace 进行了只读回放：

- Session 工具调用/结果为 24/24，错误 0；Stream 与 Session 的调用数量和 Call ID 完全一致；
- 24 条结果均含耗时，总工具耗时 404ms；
- Usage 为 11 次模型调用、149,267 Input Token、4,021 Output Token、153,288 Total Token；
- 跨源 `telemetry_valid=true`、Mismatch 0；派生产物不含 thinking 标记。

同一采集器回放 one-shot `install-001`，在没有结构化 Stream 工具事件的情况下从 Session/Usage 补回 16 次工具调用、7 次模型调用、104,074 Input Token 和 3,810 Output Token，且不会把 one-shot 的 Stream 缺失误报为不一致。该数据同时纠正了历史 Budget 结论：Input 超过 100,000，当前评测器重新执行时应为 `budget_exceeded`。

## Source Track

- 仓库：`https://github.com/D-Robotics/moss.git`；
- 固定 Commit：`1ae444721b6d66df8f4138aff5cc3e84d24cde89`；
- 源码镜像：`moss-eval-source:1ae444721b6d`；最终验证 ID `sha256:6c294dc8b8c1699b365f2a1f90c766f17bb337cd5f8fc62f6e1231005dd4178c`；
- Docker 内 `npm ci --ignore-scripts` 和 `npm run build` 成功，源码 CLI 报告 `moss v0.6.0`；
- `code-003` Source Trial：Outcome PASS、Safety PASS、149,267 输入 Token超过 100,000，最终 `budget_exceeded`；运行位于 `.moss-eval/runs/20260818T072806-source-code-003/`。
- 最终 Source 配置以 Agent 名 `moss` 运行 `install-001`；历史 Summary 明确记录了 `track=source`、完整 Commit 和最终镜像 ID，但因 one-shot Usage 当时未进入 Budget Gate 而误记为 PASS。原生回放确认应为 `budget_exceeded`；历史 Artifact 不回写，运行位于 `.moss-eval/runs/20260818T073719-source-install-001/`。

## 尚未声称通过

- 真实 PTY 多轮交互和中断、排队、转向行为；
- 真实 MOSS browser tool 针对受控测试站点的完整 Trial；
- 机器人、板端、相机和 ROS 实机连接；
- 50 项候选任务的领域专家人工金标与 Regression Suite 批准。

这些项需要交互后端、测试页面或设备清单。当前 Fixture 和 Oracle 可以验证数据管道，但不能替代上述外部系统。
