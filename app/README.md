# MOSS Eval Desktop

Windows 桌面客户端使用“选择 Agent → 配置评测 → 运行与结果”三步引导流程。用户从 GitHub 仓库或本地项目文件夹导入 Agent，客户端在不修改原项目的前提下自动分析、准备隔离环境、运行 `moss-eval`，并展示实时状态、覆盖率、轨迹诊断、历史和版本对比。技术快照、Adapter 和 provenance 信息默认收在可展开详情中。

Windows MVP 使用单独安装的 Docker Desktop 作为本地沙箱。客户端会自动检测 WSL2、虚拟化、Docker 安装和 daemon；缺失时提供官方安装入口，并在用户已提交准备请求的情况下保存完整配置、待环境恢复后自动继续一次。

MOSS 源码评测只需填写 HTTPS Base URL、一次性 API Key 和模型名，并可在 Prepared Target 中执行受限连接测试。客户端默认从 URL 自动识别 OpenAI Compatible 或 Anthropic Messages 协议；自定义 Anthropic 网关可在高级设置中覆盖。API Key 不进入恢复草稿、命令参数或 artifacts，临时 MOSS 配置在进程结束后清理。

## 开发与打包

```powershell
cd app
npm ci
npm start
npm run dist:win
```

`dist:win` 生成 NSIS 与 portable 构建，并在 `dist/checksums.sha256` 写入校验和。`build-provenance.json` 记录应用/核心版本、Git 提交、dirty 状态、Node、平台和架构。

主进程只暴露 schema 校验后的窄 API。渲染器不能运行任意命令、访问任意文件、结束任意 PID 或直接接触密钥。评测运行位于独立 Electron utility process；源码检查阶段不执行仓库代码。

完整的输入、环境、安全、数据目录、遥测和故障排查说明见 [桌面客户端运行手册](../docs/DESKTOP_CLIENT.md)。
