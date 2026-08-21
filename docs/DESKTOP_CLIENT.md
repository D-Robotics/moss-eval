# MOSS Eval 桌面客户端运行手册

## 支持的输入

- 公开、无凭据的 GitHub HTTPS 仓库 URL，可指定分支、标签或完整提交；评测记录解析后的 40 位 commit。
- 本地目录；客户端流式复制到不可变快照，不修改原目录。
- 自动检测 MOSS，或使用受版本控制的 `.moss-eval/harness.json`。无法确定时可在界面中审阅并确认引导配置。

默认排除 `.git`、`node_modules`、虚拟环境、缓存、`.env`、私钥与凭据文件；拒绝路径穿越、符号链接/目录联接逃逸、超大文件和超限快照。

## 三步引导界面

客户端的主流程为 `选择 Agent → 配置评测 → 运行与结果`。首页只要求选择 GitHub 仓库或本地项目文件夹，统一使用“导入并分析”；分支、标签和 Commit 位于“高级设置”。底层仍创建不可变评测副本，但主界面只说明“原项目不会被修改”，fingerprint、provenance、Adapter 证据和原始 JSON 收在“技术详情”中。

后续步骤不会静默失效：如果用户提前点击“配置评测”或“运行与结果”，页面会保留在可操作步骤并说明尚缺的前置条件。导入、环境准备、连接测试和评测启动会立即显示忙碌状态并阻止重复点击；失败时保留非敏感输入，显示字段级纠正提示和重试路径。API Key 始终不进入恢复草稿。

## Windows 前置条件与首次启动

- 64 位 Windows 10 22H2（build 19045）或 Windows 11 23H2（build 22631）及更新版本。安装版自带运行时，终端用户不需要另装 Node.js。
- 已启用虚拟化与 WSL2。
- 单独安装的 Docker Desktop，以及可访问的 Docker daemon。
- 足够的磁盘空间容纳来源快照、Prepared Target 镜像和每次 Trial 的 artifacts。

界面顶端和“配置评测”页的环境向导分别检测 Windows、架构、磁盘、WSL2、Windows hypervisor、Docker 安装和 Docker daemon。Docker 即使没有加入 `PATH`，客户端也会识别官方 per-user 和 all-user 安装目录。

首次使用流程：

1. 用户仍可先导入 GitHub 或本地源码并完成静态检查。
2. 如果 Docker 未安装，点击“下载并安装 Docker Desktop”会打开 [Docker 官方 Windows 安装页](https://docs.docker.com/desktop/setup/install/windows-install/)；WSL2 或虚拟化缺失时只打开对应的 Microsoft 官方说明。
3. Docker 已安装但 daemon 未运行时，点击“启动 Docker Desktop”，客户端只启动在受支持固定目录中发现的官方程序。
4. 如果用户已经点击准备 Target，客户端会把审阅后的源码快照引用、网络授权和评测配置保存在应用本地。环境健康后自动提交一次准备；客户端或 Windows 重启后也会恢复，不需要重新填写。
5. 自动准备若因源码构建、权限或网络失败，不会循环重试；处理错误后由用户再次确认。

客户端不会静默下载、提权、接受 Docker 许可协议或修改 BIOS/Windows 可选功能。Docker Desktop 在大型企业中的商业使用可能需要付费订阅，请由用户或组织确认适用许可。

## 权限与安全模型

1. 来源导入和 Harness 检查不执行仓库代码。
2. 准备前必须审阅来源 fingerprint、入口、适配器、网络、named secret 和预算并明确确认。
3. Trial 默认禁网、只读根文件系统、drop all capabilities、no-new-privileges，并限制 CPU、内存、PID、磁盘和墙钟时间。
4. 网络或 secret 只接受作用域授权；secret 值不进入命令参数、UI、轨迹或导出报告。
5. 渲染器使用 context isolation、sandbox、禁用 Node、限制 CSP、阻止远程导航；不提供任意命令、文件路径或 PID API。

## MOSS 模型配置

源码仓不会提交发布时注入的内置模型配置，因此评测本地或 GitHub MOSS 源码时，需要在“配置评测”页面填写模型：

1. 填写模型服务的 HTTPS Base URL、API Key 和模型名。
2. 客户端从 URL 自动识别 API 协议：Anthropic 官方地址使用 Anthropic Messages，其余已知和自定义网关默认使用 OpenAI Compatible。
3. 仅当自定义网关使用 Anthropic Messages 语义时，展开高级设置并手动切换 API 协议；常规网关不需要选择服务商。
4. 勾选“允许评测时访问模型公网”。评测环境准备完成后可点击“测试连接”。该操作在受限 Docker 沙箱中发起一次最多 1 token 的请求，显示 HTTP 状态和耗时，不创建任务 Trial。
5. 连接成功后开始评测。Model、Base URL 和非敏感协议设置可随草稿恢复；API Key 不保存，页面重载后必须重新填写。

API Key 只通过 schema 校验后的 IPC 进入评测 Worker 内存。Worker 在连接测试或 Trial 开始前创建 `/run/.secrets/moss-model.json`，Docker 参数只包含该路径；进程结束、失败、超时或取消时均删除临时文件。密钥不会写入 `localStorage`、环境变量投影、Fingerprint、事件、Trace、报告或导出文件。

## 数据目录

开发版和安装版都把可变数据放在 Electron `userData` 下，分为 `config/`、`sources/`、`targets/`、`runs/`、`cache/` 和 `logs/`。安装资源只读地位于 `resources/project/`。本地原目录不作为 Trial workspace。

## 遥测与指标

- L0：最终结果/沙箱状态，可计算 Outcome。
- L1：结构化工具调用，可计算名称、格式、参数、顺序、精确率、召回率、F1、冗余和效率。
- L2：模型调用、Token 和成本。
- L3：重试、压缩、子 Agent 等生命周期事件。

缺少所需证据时指标显示 unavailable；能力不匹配显示 `NOT_APPLICABLE`，不按失败计。正式 release 指标只包含 16 条 gated 任务，34 条未硬化任务单列 experimental。

## 运行与报告

流程为：选择 Agent → 自动分析 → 配置评测与模型 → 准备评测环境 → 运行与结果。主界面显示阶段、活动任务、完成/通过数量和结果入口；原始事件位于“实时技术轨迹”。关闭或刷新窗口后可从追加事件与规范 artifacts 恢复。

报告包含 Outcome、失败归因、grader、分母、遥测覆盖、成本/耗时、来源 commit 和镜像 digest。支持脱敏 JSON 与 Markdown 导出；版本对比只使用共同 eligible 任务交集，并单列覆盖率变化。

## 限制与排障

- 私有 GitHub 仓库尚不在 MVP 支持范围，不能把 token 填入 URL。
- Docker 不可用时不能以本地执行回退运行不受信任 Harness。
- Doctor 的安装按钮依赖系统默认浏览器；受企业策略限制时，请由 IT 按官方文档部署 Docker Desktop、WSL2 和虚拟化能力。
- Browser、device、PTY、ACP 和 subagent 场景仍是 experimental，除非后续补齐真实状态转换 Oracle。
- `unsupported schema` 表示 artifacts 来自不兼容版本；保留原始目录并使用对应版本客户端读取。
- `interrupted` 表示存在 run 元数据但没有正常完成；可查看已落盘 Trial，不会把缺失 Trial 当失败样本。
- `MODEL_CONFIGURATION_INVALID` 表示 Model、HTTPS Base URL、API Key 或高级 API 协议设置缺失/不合法。
- `RUNTIME_NETWORK_NOT_AUTHORIZED` 表示模型连接需要公网，但用户尚未勾选本次 Run 的网络授权。
- `MODEL_CONNECTION_FAILED`、HTTP 401/403 通常表示 API Key 或账号权限问题；HTTP 404 通常表示 Base URL 或 Model 不匹配；连接测试超时需同时检查 Docker 网络、代理和模型服务可用性。
