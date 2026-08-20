# MOSS Eval Desktop

Windows 桌面客户端把 GitHub 仓库或本地 Agent Harness 导入隔离快照，经静态检查、人工确认、沙箱准备后运行 `moss-eval`，并展示实时状态、覆盖率、轨迹诊断、历史和版本对比。

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
