# MOSS Eval

独立于 MOSS 源码仓库的 Outcome-first Agent 评测框架。它在隔离 Trial 中启动 MOSS 或其他命令行 Agent，保存完整轨迹和工作区差异，先用确定性 Grader 判断真实结果，再聚合可靠性、安全、恢复、效率与成本指标。

本目录只包含新评测体系，不依赖原 `agent_eval_service` 工程代码。两者通过导出/发布 JSON 集成。

## 当前实现

- 50 个候选核心任务，按 Spec 的 8 类和 `4/12/8/6/8/5/4/3` 数量分布组织；
- One-shot、Stream JSON、PTY，以及真实 ACP stdio 驱动；
- Local、Docker、PTY Runner，Docker 默认关闭网络；
- Fixture 隔离、工作区哈希清单和文件差异；
- Command、File、Trace、LLM Rubric Grader；
- Fatal Safety Gate、预算门禁、秘密脱敏和故障注入；
- 标准化 JSONL Trace、Trial Artifact 和 Experiment Fingerprint；
- MOSS 原生 Session/Usage 遥测、跨源一致性检查、工具耗时和可选 Tool F1；
- Valid Trial Rate、Outcome Pass Rate、pass@1、pass@k、pass^k、Wilson 置信区间、Safety/Recovery、成本和 P50/P95；
- 基线对比和红/黄/绿发布门禁；
- `agent_eval_service` JSON 导出和可配置 HTTP 发布；
- 5 个确定性 smoke 任务和自动测试。

## 快速验证

要求 Node.js 22.16.0 或更高版本。

```powershell
cd D:\moss-eval
npm run check
npm test
npm run doctor
npm run doctor:wsl
npm run env:pty
npm run env:browser
npm run env:browser:docker
npm run env:device
npm run smoke
npm run calibrate
```

`smoke` 使用受信任的本地模拟 Agent，因此显式传入了 `--allow-local`。正式 MOSS 任务默认使用 Docker，不会静默降级到宿主机执行。

## 运行 MOSS

当前 MOSS CLI 支持 `moss "prompt"`、`--output-format stream-json`，ACP 服务入口为 `moss agent stdio`。先安装 MOSS，或构建隔离镜像：

```powershell
docker build --build-arg MOSS_VERSION=<固定版本> -t moss-eval:local .
node bin/moss-eval.mjs doctor --config configs/moss.example.json
node bin/moss-eval.mjs run --config configs/moss.example.json --suite capability --agent moss
```

正式基线必须把 `MOSS_VERSION`、镜像 Digest、模型、Provider 和任务版本固定下来。示例中的 `latest` 仅用于首次搭建。

如果评测 GitHub 固定提交而不是 npm 发布包，先准备 Source Track：

```powershell
node bin/moss-eval.mjs prepare-source `
  --repository https://github.com/D-Robotics/moss.git `
  --ref main
```

命令会从解析出的完整 Commit 构建独立镜像，并输出专属配置路径。详见 [Source Track](docs/SOURCE_TRACK.md)。

如果 Windows 主机使用 `RDK-Moss-Ubuntu` WSL 且 Docker Hub 不可达，可以复用该环境已有的本地基础镜像：

```powershell
wsl --distribution RDK-Moss-Ubuntu --exec sudo docker build `
  -f /mnt/d/moss-eval/Dockerfile.wsl -t moss-eval:local /mnt/d/moss-eval
node bin/moss-eval.mjs doctor --config configs/moss.wsl.example.json
```

本机已通过 `RDK-Moss-Ubuntu` WSL 的 Docker Server 29.1.3 构建并运行 `moss-eval:local`，镜像内固定为 Node 22.23.2 和 MOSS 0.6.0。50 项核心任务已用确定性参考 Agent 在 Docker 中全部通过；真实 MOSS 的 Stream JSON 和 ACP stdio 也已完成连通验证。真实 PTY 交互、Browser 后端和机器人/板端连接仍需对应的交互环境或设备，不能用 Fixture 通过冒充实机通过。

## CLI

```text
moss-eval validate  --config <file>
moss-eval list      --config <file> [--suite nightly]
moss-eval doctor    --config <file>
moss-eval calibrate --config <file> [--concurrency 4]
moss-eval run       --config <file> [--agent moss] [--task id1,id2]
moss-eval aggregate --run <run-dir> [--k 3]
moss-eval compare   --baseline <summary.json> --candidate <summary.json>
moss-eval export    --run <run-dir> [--publish --config <file>]
```

`run` 默认在交互终端显示动态状态面板，在 CI 或重定向输出时自动切换为逐行日志。也可以显式选择：

```powershell
# 动态终端面板
node bin/moss-eval.mjs run --config configs/moss.wsl.example.json `
  --suite capability --agent moss --trials 1 --progress dashboard

# 适合保存到日志文件
node bin/moss-eval.mjs run --config configs/moss.wsl.example.json `
  --suite capability --agent moss --trials 1 --progress plain
```

支持 `--progress auto|dashboard|plain|none`。面板显示运行时长、完成百分比、PASS/FAIL/INVALID、正在运行的 Trial、最近结果及 Artifact 目录。

每次运行写入 `.moss-eval/runs/<run-id>/`。每个 Trial 包含 `trial.json`、`trajectory.jsonl`、`native-telemetry.json`、`telemetry-summary.json`、`telemetry-mismatches.json`、stdout/stderr、最终回复、前后 Manifest、工作区和指纹。

## 目录

```text
bin/                 CLI
configs/             MOSS 与 mock 配置
drivers/             ACP stdio 客户端
schemas/             Task、Trace、Trial JSON Schema
src/adapters/        Agent 运行适配
src/runners/         Local、Docker、PTY 环境
src/verifiers/       Outcome、Trace、Safety、Budget、Judge
src/core/            Task、Trial、聚合、比较、指纹
taskpacks/core/      50 项核心候选任务和 Oracle
examples/            可离线运行的 smoke 闭环
test/                单元和端到端测试
docs/                Spec、任务编写和集成说明
```

## 重要边界

50 项核心任务已经可被加载和调度，但其来源状态是 `candidate-needs-domain-review`。在进入正式 Regression Suite 前，每项仍必须由领域人员用参考解执行、检查合法替代路径，并校准 Grader 的误报/漏报。框架不会把“有 50 个 JSON”冒充成已经完成人工金标。

自动校准已经覆盖全部 50 项任务：50 个确定性参考解必须通过，同时每项的“缺失结果、自引用证据、受保护文件被修改”三个反例必须失败。该门禁共 200 个控制样本，当前误报与漏报均为 0；它已经进入 CI，但不能替代领域人员审核。

详见 [实施 Spec](docs/SPEC.md)、[MOSS 原生遥测](docs/NATIVE_TELEMETRY.md)、[Source Track](docs/SOURCE_TRACK.md)、[环境要求](docs/ENVIRONMENT.md)、[验证记录](docs/VALIDATION.md)、[任务编写指南](docs/TASK_AUTHORING.md) 和 [agent_eval_service 集成](docs/AGENT_EVAL_SERVICE.md)。
