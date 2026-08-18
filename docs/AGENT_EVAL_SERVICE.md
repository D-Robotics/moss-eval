# agent_eval_service 集成

`moss-eval export --run <run-dir>` 生成 `agent-eval-service.json`。每个 Case 贯通：

- question、expected/candidate answer；
- actual/expected tool calls；
- conversation history；
- Outcome、Safety、Failure Category；
- Metrics、Graders、Fingerprint 和 Artifact 路径。

对新 Trial，`actual_tool_calls` 优先来自脱敏后的 `native-telemetry.json`，因此可附带工具状态、Outcome 和耗时；没有 MOSS 原生遥测时回退到标准化 `trajectory.jsonl`。原始 Session/Thinking 不进入导出。

如服务提供统一接收端点，可在配置中加入：

```json
{
  "integrations": {
    "agent_eval_service": {
      "url": "http://127.0.0.1:8000/api/import/moss-eval",
      "method": "POST",
      "timeout_ms": 30000,
      "headers": { "authorization": "Bearer ${TOKEN}" }
    }
  }
}
```

然后运行：

```text
moss-eval export --run <run-dir> --publish --config <config>
```

当前发布器是显式、可配置的 HTTP 边界，不假设旧服务已有固定 Import API。旧服务中的 Goal、Plan 和 Tool 指标可继续作为诊断反馈，但不得覆盖 MOSS Eval 的 Outcome/Safety 判定。
