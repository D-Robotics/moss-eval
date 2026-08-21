## ADDED Requirements

### Requirement: End-to-end desktop workflow
The desktop client SHALL provide discoverable flows for source selection, inspection, target preparation, task and repetition configuration, authorization review, execution, live monitoring, report review, comparison, and export.

#### Scenario: Evaluate a public MOSS repository
- **WHEN** a user pastes a supported MOSS GitHub URL, accepts the resolved revision and preparation policy, and starts an eligible suite
- **THEN** the client prepares the pinned target, executes the selected trials, and opens a report linked to source and target provenance

#### Scenario: Evaluate a local Harness
- **WHEN** a user selects a local directory and completes required inspection or guided configuration
- **THEN** the workflow clearly identifies the managed snapshot and never implies that the original directory is being modified

### Requirement: Narrow validated desktop boundary
The renderer SHALL access evaluator functionality only through a narrow, schema-validated API consisting of source inspection, target preparation, evaluation start, cancellation, run query/subscription, report export, and bounded settings operations. It MUST NOT receive arbitrary filesystem, process-spawn, process-kill, or unrestricted configuration-write privileges.

#### Scenario: Renderer sends an invalid request
- **WHEN** an IPC request contains an unknown method, extra privileged field, invalid identifier, or path outside an allowed selection flow
- **THEN** the main process rejects it before filesystem or process effects and returns a structured validation error

#### Scenario: Cancel a known evaluation
- **WHEN** the renderer requests cancellation using a valid active run identifier
- **THEN** the main process delegates cancellation to the owning evaluation worker without accepting an arbitrary operating-system PID

### Requirement: Dedicated evaluation worker
The desktop main process SHALL run long-lived preparation and evaluation orchestration outside the renderer and UI event loop in a dedicated worker/service process using the same core APIs as the CLI.

#### Scenario: Evaluation emits high-volume progress
- **WHEN** a run produces frequent progress and trace events
- **THEN** the worker persists canonical artifacts and sends bounded status projections without freezing renderer interaction

#### Scenario: Renderer reloads during a run
- **WHEN** the UI reloads or a window closes while the evaluation worker remains healthy
- **THEN** reopening the run reconstructs status from the worker and canonical artifacts without starting duplicate trials

### Requirement: Live status and diagnostic drill-down
The client SHALL display run counts and elapsed time; active task, trial, phase, and budget; recent outcomes; achieved telemetry; tool/model/token summaries when available; failure attribution; and artifact location as structured events arrive.

#### Scenario: Trial exceeds its budget
- **WHEN** a running trial is terminated for a time or resource budget
- **THEN** the live view and final report identify the exact trial, breached budget, last known phase, and retained diagnostic artifacts

#### Scenario: Metric is unavailable
- **WHEN** telemetry does not support a requested live metric
- **THEN** the client labels it unavailable with the reason rather than rendering zero

### Requirement: Durable history and export
The client SHALL discover and index canonical runs from evaluator-managed storage, tolerate a rebuildable or missing UI index, and export a self-contained machine-readable report plus a human-readable summary with redaction applied.

#### Scenario: Client restarts
- **WHEN** the installed client restarts after completed or interrupted runs
- **THEN** history is reconstructed from canonical artifacts and interrupted states are identified accurately

#### Scenario: Export a report
- **WHEN** the user exports a completed run
- **THEN** the export includes results, metric definitions and denominators, source/target/task-suite provenance, warnings, and redacted diagnostic references

### Requirement: Desktop web-content security
The client SHALL keep context isolation and renderer sandboxing enabled, disable Node integration in web content, enforce a restrictive Content Security Policy, render untrusted source and trace text without HTML interpretation, and prohibit remote navigation by default.

#### Scenario: Trace contains markup or script text
- **WHEN** Harness output contains HTML, script, or event-handler text
- **THEN** the renderer displays it as inert text and no code executes in the renderer context

### Requirement: Explicit MOSS model configuration
The desktop client SHALL allow a MOSS user to select DeepSeek, Qwen, OpenAI, Anthropic, or OpenAI Compatible; enter a model; review the effective base URL; enter a password-masked API key; explicitly authorize model-network access; and test the connection before starting an evaluation.

#### Scenario: Select a preset provider
- **WHEN** the user selects DeepSeek, Qwen, OpenAI, or Anthropic
- **THEN** the client fills the trusted provider base URL, keeps it read-only, and requires a model and API key before connection testing or evaluation

#### Scenario: Configure an OpenAI-compatible provider
- **WHEN** the user selects OpenAI Compatible
- **THEN** the client permits an explicit HTTPS base URL and validates it before any network request

#### Scenario: Test a model connection
- **WHEN** the user supplies valid model settings and authorizes runtime network access
- **THEN** the client runs a bounded connection test through the prepared target and reports sanitized success, latency, or failure diagnostics without starting a task Trial

#### Scenario: Renderer reloads or preparation resumes
- **WHEN** the renderer reloads or restores a pending preparation draft
- **THEN** provider, model, and non-secret base URL settings may be restored but the API key is empty and must never have been written to local storage
