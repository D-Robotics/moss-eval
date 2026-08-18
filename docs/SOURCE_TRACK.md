# Source Track

Source Track 用固定 Git Commit 构建 MOSS，而不是直接安装 npm 发布包。它与 Release Track 使用相同任务、环境、预算和 Grader，但运行结果分目录保存，并在 Summary 和 Trial Fingerprint 中标注 `track=source`。

## 准备固定提交

```powershell
cd D:\moss-eval

node bin/moss-eval.mjs prepare-source `
  --repository https://github.com/D-Robotics/moss.git `
  --ref main
```

命令会：

1. 用 `git ls-remote` 把 ref 解析为完整 40 位 Commit；
2. 创建只含该 Commit 的本地检出；
3. 用 `git archive` 生成干净源码构建上下文；
4. 在 Docker 中执行 `npm ci --ignore-scripts` 和 `npm run build`；
5. 将源码编译的 `packages/moss-agent/dist/cli.js` 注册为容器内 `moss`；
6. 校验镜像内 Commit 文件和 `moss --version`；
7. 生成 Source Manifest 和专属评测配置。

产物位于：

```text
.moss-eval/sources/moss/<full-commit>/
.moss-eval/source-track/<short-commit>/source-manifest.json
.moss-eval/source-track/<short-commit>/config.json
```

## 执行

`prepare-source` 会输出配置的绝对路径。使用该配置运行时，Agent 名称仍为 `moss`，以便与 Release Track 的 Summary 做同名比较；`track`、Commit 和 Image Digest 用于区分来源。

```powershell
node bin/moss-eval.mjs run `
  --config D:\moss-eval\.moss-eval\source-track\<short-commit>\config.json `
  --suite capability `
  --agent moss `
  --trials 1 `
  --progress dashboard
```

## Provenance

每个 Trial 记录：

- Source repository、ref、完整 Commit 和 dirty 状态；
- Source Track Docker Image ID；
- 基础 Release Image ID；
- MOSS 包版本；
- Task、Config、Prompt Policy 和 Tool Schema 指纹字段；
- Node、平台、资源、网络和预算。

源码版首次使用的公开零配置模型网关文件来自固定的官方 npm Release 基础镜像；Agent runtime、CLI、工具和协议实现全部从目标 Commit 编译。此 bootstrap 来源会明确写入 Source Manifest 与 Trial Fingerprint，不作为源码构建产物冒充。

## 当前验证

2026-08-18 已对 `D-Robotics/moss` main 提交 `1ae444721b6d66df8f4138aff5cc3e84d24cde89` 完成源码构建，最终镜像 ID 为 `sha256:6c294dc8b8c1699b365f2a1f90c766f17bb337cd5f8fc62f6e1231005dd4178c`。

- 最终 Source 配置运行 `install-001`：历史 Summary 曾因 one-shot 未向 Stream 输出 Usage 而记录为 PASS；原生 Usage 回放得到 104,074 Input Token、3,810 Output Token，Input 超过 100,000 预算。当前评测器重新执行同一场景时会正确判为 `budget_exceeded`。历史运行目录保留原状：`.moss-eval/runs/20260818T073719-source-install-001/`。
- `code-003`：Outcome 和 Safety 通过，输入 Token 149,267 超过 100,000 预算，因此总体为 `budget_exceeded`；运行目录：`.moss-eval/runs/20260818T072806-source-code-003/`。

这些结果证明 Source Track 闭环和来源指纹有效，不能替代 50 任务、多 Trial 的正式基线。
