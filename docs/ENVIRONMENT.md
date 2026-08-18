# PTY, Browser and Device environment

## 已安装并验证

本机已具备以下可重复环境：

- PTY：`node-pty 1.1.0`，通过 ConPTY 启动真实 `moss v0.6.0`；
- Browser：`playwright 1.62.1` 和 Playwright Chromium 151.0.7922.34；
- Docker Browser：`moss-eval:local` 内置相同版本的 Linux Chromium，并通过 `MOSS_BROWSER_EXECUTABLE` 提供给 MOSS browser tools；
- Device simulator：WSL Docker 镜像 `moss-eval-device-sim:local`，包含隔离 OpenSSH Server；
- SSH client：Harness 使用 `ssh2 1.17.0` 保持一个 SSH 连接并复用多个执行 channel；
- Docker：`RDK-Moss-Ubuntu` WSL 中的 Docker Server 29.1.3。

运行自检：

```powershell
cd D:\moss-eval
npm run env:pty
npm run env:browser
npm run env:browser:docker
npm run env:device:build
npm run env:device
npm run doctor:wsl
```

Browser 自检会验证表单的 loading/success 状态和控制台事件，并把截图写到 `.moss-eval/env-check/browser-check.png`；Docker Browser 自检会以非特权评测用户启动镜像内的 headless Chromium。Device 自检为临时容器分配随机 loopback 端口、使用临时公钥认证，并在一个 SSH 连接上连续执行两条命令；容器在检查结束后删除。

## 真实设备验收仍需提供

SSH 模拟器可以验证连接、认证、复用、超时和重连逻辑，但不能证明真实硬件能力。真实 Device/ROS/Camera 任务至少需要：

- 一块明确型号的 D-Robotics RDK 板，并提供系统版本；
- PC 与板端可达的 IP、SSH 用户和专用测试公钥；
- 与板型兼容的相机模组及已断电完成的物理连接；
- 板端安装匹配系统版本的 TROS/ROS 2、相机节点和驱动；
- 允许评测读取 `ros2 topic list`、节点列表、相机设备和系统信息；
- 单独的测试工作区以及禁止运动、GPIO 写入和系统升级等权限边界。

板型、系统镜像和相机型号未确定前，不应在 PC 或 WSL 中盲目安装某个 ROS 发行版：它不能替代板端驱动，还可能与目标 TROS 版本不一致。确定硬件后，再把真实端点写入不入库的本地配置，并运行实机套件。
