# Canonical evaluation artifact layout

MOSS Eval 1.x stores each run under its configured run root. JSON files are the source of truth for both the CLI and desktop client.

```text
runs/<run-id>/
  run.json
  summary.json
  trials/
    <task-id>/
      <agent-id>/
        trial-<replicate>/
          trial.json
          trajectory.jsonl
          stdout.log
          stderr.log
          final-response.txt
          initial-manifest.json
          final-manifest.json
          native-telemetry.json
          telemetry-summary.json
          telemetry-mismatches.json
          workspace/
```

`run.json`, `summary.json`, and every `trial.json` carry a `schema_version`. Readers must reject unsupported versions instead of guessing. A legacy layout such as `runs/<run-id>/<task-id>/trial.json` is diagnosed explicitly and is never silently mixed with canonical trials.

Trial identity is the tuple `(task.id, agent, replicate)`. File and directory names are sanitized storage segments; consumers must read identity from `trial.json` rather than reverse-engineering it from a path.
