# MOSS Eval 桌面客户端运行手册

## 支持的输入

- 公开、无凭据的 GitHub HTTPS 仓库 URL，可指定分支、标签或完整提交；评测记录解析后的 40 位 commit。
- 本地目录；客户端流式复制到不可变快照，不修改原目录。
- 自动检测 MOSS，或使用受版本控制的 `.moss-eval/harness.json`。无法确定时可在界面中审阅并确认引导配置。

默认排除 `.git`、`node_modules`、虚拟环境、缓存、`.env`、私钥与凭据文件；拒绝路径穿越、符号链接/目录联接逃逸、超大文件和超限快照。

## Windows 前置条件

- 64 位 Windows、Node.js 22.16 或更新版本。
- 已启用虚拟化与 WSL2。
- Docker CLI 与可访问的 Docker daemon。
- 足够的磁盘空间容纳来源快照、Prepared Target 镜像和每次 Trial 的 artifacts。

界面顶端的 Doctor 区分“未安装 Docker CLI”和“daemon 未运行”，并给出对应修复建议。

## 权限与安全模型

1. 来源导入和 Harness 检查不执行仓库代码。
2. 准备前必须审阅来源 fingerprint、入口、适配器、网络、named secret 和预算并明确确认。
3. Trial 默认禁网、只读根文件系统、drop all capabilities、no-new-privileges，并限制 CPU、内存、PID、磁盘和墙钟时间。
4. 网络或 secret 只接受作用域授权；secret 值不进入命令参数、UI、轨迹或导出报告。
5. 渲染器使用 context isolation、sandbox、禁用 Node、限制 CSP、阻止远程导航；不提供任意命令、文件路径或 PID API。

## 数据目录

开发版和安装版都把可变数据放在 Electron `userData` 下，分为 `config/`、`sources/`、`targets/`、`runs/`、`cache/` 和 `logs/`。安装资源只读地位于 `resources/project/`。本地原目录不作为 Trial workspace。

## 遥测与指标

- L0：最终结果/沙箱状态，可计算 Outcome。
- L1：结构化工具调用，可计算名称、格式、参数、顺序、精确率、召回率、F1、冗余和效率。
- L2：模型调用、Token 和成本。
- L3：重试、压缩、子 Agent 等生命周期事件。

缺少所需证据时指标显示 unavailable；能力不匹配显示 `NOT_APPLICABLE`，不按失败计。正式 release 指标只包含 16 条 gated 任务，34 条未硬化任务单列 experimental。

## 运行与报告

流程为：选择来源 → 审阅 provenance/静态检查 → 确认准备策略 → 选择 suite、重复次数、随机化和遥测要求 → 运行。实时页显示阶段、活动 Trial、完成/通过数量和事件；关闭或刷新窗口后可从追加事件与规范 artifacts 恢复。

报告包含 Outcome、失败归因、grader、分母、遥测覆盖、成本/耗时、来源 commit 和镜像 digest。支持脱敏 JSON 与 Markdown 导出；版本对比只使用共同 eligible 任务交集，并单列覆盖率变化。

## 限制与排障

- 私有 GitHub 仓库尚不在 MVP 支持范围，不能把 token 填入 URL。
- Docker 不可用时不能以本地执行回退运行不受信任 Harness。
- Browser、device、PTY、ACP 和 subagent 场景仍是 experimental，除非后续补齐真实状态转换 Oracle。
- `unsupported schema` 表示 artifacts 来自不兼容版本；保留原始目录并使用对应版本客户端读取。
- `interrupted` 表示存在 run 元数据但没有正常完成；可查看已落盘 Trial，不会把缺失 Trial 当失败样本。
