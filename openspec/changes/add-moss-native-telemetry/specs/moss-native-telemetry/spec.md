## ADDED Requirements

### Requirement: Native MOSS telemetry collection
The evaluator SHALL collect available MOSS session and LLM usage JSONL files from an isolated trial workspace after the agent process stops, without requiring MOSS source changes.

#### Scenario: Native files are available
- **WHEN** a MOSS trial writes session and usage JSONL files
- **THEN** the evaluator produces a normalized native telemetry artifact linked to that trial

#### Scenario: Native files are unavailable
- **WHEN** an agent or MOSS mode does not write native telemetry files
- **THEN** the evaluator records the source as unavailable and continues using generic trace data

### Requirement: Privacy-preserving extraction
The evaluator MUST extract only allowlisted structured telemetry and MUST NOT copy private thinking, arbitrary assistant message text, or secret values into public native telemetry artifacts.

#### Scenario: Session contains thinking and a secret canary
- **WHEN** a session row includes thinking content or configured secret values
- **THEN** the public native telemetry artifact contains neither the thinking content nor the canary

### Requirement: Tool lifecycle normalization
The evaluator SHALL normalize tool call ID, tool name, redacted arguments, status, outcome, duration, abort state, and bounded result summary when present.

#### Scenario: Detailed tool result is persisted
- **WHEN** a native session contains a tool result with `durationMs`, `outcome`, and `is_error`
- **THEN** the normalized tool lifecycle retains those fields under the common schema

### Requirement: Exact usage metrics
The evaluator SHALL use valid native LLM usage records to calculate model-call count and token components for MOSS trials instead of assistant-message count.

#### Scenario: Usage records and messages differ
- **WHEN** a trial has eleven valid usage records and nine assistant messages
- **THEN** `model_call_count` equals eleven

### Requirement: Cross-source telemetry reconciliation
The evaluator SHALL compare native and generic source counts, retain per-source values, and report structured mismatches.

#### Scenario: Tool counts agree
- **WHEN** Stream JSON and Session JSONL both contain 24 tool calls with matching call IDs
- **THEN** tool telemetry is marked valid with no count mismatch

#### Scenario: Tool counts disagree
- **WHEN** Stream JSON contains 24 calls and Session JSONL contains 23
- **THEN** telemetry is marked invalid for trusted tool aggregation and the task Outcome remains unchanged

### Requirement: Optional tool expectation scoring
The evaluator SHALL support optional set- and policy-based tool expectations and SHALL return null correctness metrics when no tool oracle is declared.

#### Scenario: Expected and forbidden tools are declared
- **WHEN** a task declares expected and forbidden tool sets
- **THEN** the evaluator reports selection precision, recall, F1, and forbidden-call violations from observed native calls

#### Scenario: No tool expectations are declared
- **WHEN** a task has no tool expectation block
- **THEN** tool correctness metrics are null rather than inferred from the agent path

### Requirement: Source-track parity
Release and Source tracks SHALL emit the same native telemetry schema and retain their existing provenance fields.

#### Scenario: Same task runs on both tracks
- **WHEN** Release and Source MOSS agents execute the same task
- **THEN** their telemetry artifacts are structurally comparable and remain distinguishable by track and source commit
