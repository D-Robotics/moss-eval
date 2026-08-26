# Professional Dataset Specification

本规范定义 `moss-eval` 专业 Agent 数据集的合同、生产流水线和对外声明边界。目标不是堆积任务数量，而是让每一个评分结论都能追溯到固定输入、独立证据、隔离 Oracle 和可重复运行。

## 1. 数据集分轨

每项任务必须且只能属于一个 Track：

- `adapter-conformance`：验证协议、事件、工具与 Harness 接线，不代表通用能力；
- `general-capability`：跨 Agent 可比较的通用任务，需经过完整发布流程；
- `target-regression`：来自目标 Agent 的真实失败模式，只用于该目标的回归；
- `private-business`：来自授权业务分布，必须记录许可、保密级别与留存策略。

`taskpacks/core` 的历史 50 项任务是 integration/candidate pack。它们可以验证执行器、Artifact 和聚合器，但在领域审核、私有 Holdout 和跨 Agent Pilot 完成前，不得称为专业基准。

## 2. Task Card 合同

每项任务拥有独立目录和 `task-card.json`，至少记录：稳定 ID 与版本、Track、类别与构念、作者身份和创作方式、来源许可、隐私级别、污染状态、Fixture 家族、Runtime Task、Oracle、正反控制、独立复核以及 Pilot 要求。所有路径必须是数据集内安全相对路径，所有可执行输入和证据均使用 SHA-256 固定。

任务状态不能由作者填写。流水线只根据证据派生：

`candidate -> calibrated -> reviewed -> pilot -> release-eligible`

任何缺失、摘要漂移、执行错误或证据不足都会保持在较低状态，并输出精确 blocker。

## 3. 任务生产流水线

1. 从真实失败案例、授权业务需求或明确的合成能力假设形成 Task Card；
2. 独立创建最小 Fixture，避免共享状态和样板泄漏；
3. 编写只判断行为和最终状态的确定性 Oracle，不固定合法工具顺序；
4. 为每项任务提供至少两个实质不同的正确解，以及三个任务特定的可信失败解；
5. 在全新临时工作区逐一运行生产 Oracle，校准漏报、误报、崩溃、超时和隔离性；
6. 由非作者的领域审阅者与评测审阅者批准，并记录污染与隐私复核；
7. 使用至少三个 Agent 家族、每项至少九个有效观察和至少三次重复进行 Pilot，检查难度、区分度、pass@k 与 pass^k；
8. 把私有 Oracle 作为独立外部 Bundle 保存，发布清单只固定其摘要，不把内容写入公开仓库；
9. 只有全部门禁通过时才生成不可变 Professional Release Manifest。

## 4. Oracle 隔离

专业任务必须声明 `oracle_isolation: evaluator-only`。Agent 阶段只挂载 `/workspace` 和 Trial 的 `/run`，看不到 `/task`、`/eval` 或 `/oracle`。Agent 结束后，Command Grader 在新的 grader phase 中以只读方式挂载评测代码和 Oracle。每个 Trial 会把阶段和实际挂载角色写入 Artifact，供审计。

公开种子包中的 Oracle 仅用于开发和 CI。其 `distribution` 与污染标记会强制阻止生成隐藏评分发布，不能通过改一个状态字段绕过。

## 5. 自动门禁

```powershell
npm run dataset:audit
npm run dataset:calibrate
npm run dataset:release-blocked
```

- `dataset:audit`：检查合同、路径、摘要、密钥、未声明文件、重复 Fixture、重复 Prompt/Oracle 组合、构念集中度和覆盖分布；
- `dataset:calibrate`：在隔离工作区运行每项任务的全部正反控制，任何已知误判或执行错误均失败；
- `dataset:release-blocked`：CI 必须证明公开开发种子在缺少人工、私有与 Pilot 证据时无法发布。

JSON 与 Markdown 报告写入 `.moss-eval/datasets/<dataset-id>-<version>/`。报告不写入密钥或原始私有 Oracle。

## 6. 人工角色与职责分离

- Author：编写任务，不能批准自己的任务；
- Domain Reviewer：确认业务语义、正确解和失败解真实性；
- Evaluation Reviewer：检查 Oracle、替代路径、评分边界与可复现性；
- Privacy/Security Reviewer：私有或敏感任务必须参与，确认许可、脱敏、保留和访问范围；
- Release Owner：只依据完整证据签发版本，不得补写或模拟复核记录。

人工审批、私有 Holdout 和跨 Agent Pilot 属于外部事实，自动化不能代签，也不能用合成记录冒充。

## 7. 版本与声明

Fixture、指令、Oracle、控制样本、隐私或评分语义发生变化时必须提升 Task Version；任务集合、政策或任务摘要变化时必须提升 Dataset Version。发布清单固定数据集、校准、Pilot 和私有 Oracle Bundle 摘要，任一内容漂移都使验证失败。

允许的声明层级：

- Technical gate passed：仅表示格式、摘要、隔离和自动控制通过；
- Development Canary：仅表示某目标在公开开发任务上完成真实连通运行；
- Professional score：只有 release eligibility 成立、使用锁定 Release Manifest 和私有 Holdout 时才能声明。

## 8. 目标代码合规

验证公开目标时，从权威远端解析完整 Commit，并创建独立的干净快照和内容寻址镜像。不得用本地脏工作区作为正式目标，也不得修改用户现有 checkout。报告必须记录仓库、Ref、Commit、镜像 Digest、模型配置指纹和网络授权；密钥只通过短期 Secret Surface 注入，结束后清理且不进入 Trace。
