## Why

MOSS already persists authoritative tool and model telemetry, but moss-eval currently derives most process metrics from CLI output alone. This loses tool duration and outcome detail, miscounts model calls in some runs, and cannot detect incomplete or inconsistent traces.

## What Changes

- Add a MOSS-native telemetry adapter that reads sanitized facts from session JSONL and LLM usage JSONL after each trial.
- Merge native telemetry with the live Stream JSON/ACP trace under explicit source-precedence rules.
- Emit public, redacted telemetry artifacts and mismatch diagnostics without exporting private thinking.
- Correct model-call, token, tool-status, tool-duration, and per-tool metrics.
- Add optional task-level tool expectations for selection precision/recall/F1 and policy checks without requiring one rigid path.
- Preserve outcome grading independence: telemetry failures affect process-metric eligibility, not deterministic task outcome.

## Capabilities

### New Capabilities

- `moss-native-telemetry`: Extract, normalize, redact, reconcile, and score MOSS-native Session and Usage telemetry for each evaluation trial.

### Modified Capabilities

None.

## Impact

- Affects the evaluation pipeline, trial artifacts, trace metrics, aggregation, task validation, and terminal/report output in `D:\moss-eval`.
- Reads existing files under a trial workspace's `.moss/` directory; no MOSS source modification is required.
- Adds no required external service. OpenTelemetry remains an optional later data source because the current MOSS CLI couples local file traces to OTLP enablement.
