## Context

MOSS emits live Stream JSON/ACP events and also persists richer native files under each workspace: `.moss/sessions/*.jsonl` contains messages with tool calls/results, and `.moss/llm-usage.jsonl` contains per-request model usage. moss-eval currently normalizes only process output, drops native tool duration/outcome fields, and approximates model calls with assistant-message count. Trial workspaces are isolated, so native files can be collected after process exit without changing MOSS behavior.

## Goals / Non-Goals

**Goals:**

- Produce a deterministic, redacted native telemetry artifact for every MOSS trial.
- Preserve detailed tool lifecycle facts and exact per-request usage.
- Reconcile independent sources and expose completeness without changing Outcome/Safety semantics.
- Support optional, task-declared tool expectations without enforcing one exact execution path.
- Keep Release and Source tracks on the same telemetry schema.

**Non-Goals:**

- Modify or instrument the MOSS repository.
- Export private thinking or unrestricted tool output in public artifacts.
- Make OpenTelemetry or an external collector mandatory.
- Treat a particular plan or complete tool sequence as universally correct.

## Decisions

### Collect after process exit

The evaluator will read native files after the agent stops and before workspace grading completes. This avoids tail races and guarantees MOSS shutdown has flushed usage/session data. Missing files are represented as unavailable sources, not process failures.

### Use source-specific authority

- Stream JSON/ACP remains authoritative for live progress and cross-agent compatibility.
- Session JSONL is authoritative for MOSS tool call/result detail.
- LLM usage JSONL is authoritative for MOSS model-call count and token components.
- External deterministic graders remain authoritative for Outcome and Safety.
- OTel is optional diagnostic enrichment and is not required in this change.

Native facts override weaker derived fields only when native telemetry parses successfully. Source counts are retained so disagreements remain auditable.

### Emit sanitized derivatives

The collector will traverse message content only for `tool_use` and `tool_result` blocks. It will not copy message text, thinking fields, checkpoints, or raw session rows. Inputs and results pass through existing secret redaction and size bounds. Raw `.moss` files remain local workspace artifacts and are not linked as public report payloads.

### Reconcile without changing task outcome

The system computes a telemetry-valid flag and mismatch list for counts and token totals. A mismatch excludes affected process metrics from trusted aggregation but does not convert an otherwise passing deterministic Outcome/Safety result into failure. Telemetry validity is reported separately.

### Tool expectations are optional and set-based

Tasks may declare required-any, required-all, forbidden tools, a maximum call count, and mutation-verification requirements. Precision/recall/F1 uses observed tool names against declared expected sets. Tasks without expectations receive null correctness metrics, avoiding fabricated ground truth.

## Risks / Trade-offs

- [MOSS session schema evolves] → Use tolerant field aliases, schema/version metadata, and fixture tests for state-replace and append-message shapes.
- [Session contains sensitive reasoning] → Extract an allowlisted structure only; never persist raw message/thinking content in telemetry artifacts.
- [Same tool result appears in multiple source records] → Deduplicate by tool call ID and record conflicts.
- [One-shot mode has no live structured events] → Native session/usage data supplies post-run metrics while live dashboard remains process-level.
- [OTel file mode currently implies OTLP setup] → Leave OTel optional until a clean collector or file-only mode is available.
- [Task tool oracle becomes path-rigid] → Keep declarations optional and set/policy-based; Outcome never depends on exact order by default.

## Migration Plan

1. Add the collector and fixture tests without changing aggregate gates.
2. Merge native fields into trial metrics and retain legacy fields for compatibility.
3. Add telemetry validity and optional tool-quality metrics to summaries/reports.
4. Replay existing real MOSS trial directories to verify expected counts and usage.
5. Roll back by disabling native collection; Stream-only evaluation remains functional.

## Open Questions

- A later change may add a managed local OTLP collector and span-level latency correlation.
- Public report packaging should eventually exclude or encrypt raw trial workspaces that contain MOSS session history.
