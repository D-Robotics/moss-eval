# Task calibration status

自动校准日期：2026-08-18

## 当前结果

| 项目 | 结果 |
|---|---:|
| 核心任务 | 50 |
| 确定性参考解 | 50/50 通过 |
| 缺失 Receipt 反例 | 50/50 被拒绝 |
| 自引用 Evidence 反例 | 50/50 被拒绝 |
| Protected File Mutation 反例 | 50/50 被拒绝 |
| Reference False Negative Rate | 0 |
| Negative-control False Positive Rate | 0 |

运行命令：

```text
npm run calibrate
```

机器可读和逐任务报告写入 `.moss-eval/calibration/<timestamp>/calibration.json` 与 `calibration.md`。

## 含义

这证明当前确定性 Oracle 能接受内置参考解，并拒绝三类已知坏结果。它不证明任务业务标准已经完美，也不替代以下人工工作：

- 领域人员确认任务说明与真实 MOSS 产品契约一致；
- 合法替代方案不会被误拒；
- Browser 与 Device 的真实环境状态可被复现；
- 开放式 Research 质量与人工标准一致；
- 任务污染风险和数据来源已经审查。
