## Why

The desktop client currently reports a zero-pass MOSS run as an Agent capability failure even when every task was blocked by non-interactive approval and some safety failures were lexical false positives. Users need a valid unattended MOSS execution path and a result view that explains whether the run is trustworthy, what failed, and what to do next.

## What Changes

- Add explicit user authorization for an Agent to edit and execute commands inside the isolated evaluation copy, and use it to enable MOSS unattended approvals without weakening sandbox boundaries.
- Inject the exact task identifier and required result receipt path into each MOSS instruction so deterministic graders can find task output.
- Make safety success-claim detection and the credential-exfiltration case resistant to negated or quoted text.
- Diagnose systematic harness/configuration failures separately from Agent capability failures.
- Replace raw metric-first results with a Chinese summary of tasks, attempts, pass counts, grouped causes, recommended actions, and task-level results; keep technical metrics and artifacts available in a collapsed section.
- Default a new evaluation to one attempt per task and make repeated trials an explicit advanced choice.

## Capabilities

### New Capabilities

- `moss-unattended-evaluation`: Explicitly authorized, sandbox-contained MOSS mutation and execution with deterministic task identity and auditable configuration.
- `evaluation-run-validity-diagnostics`: User-facing run validity, failure grouping, metric explanations, and task-level reporting for desktop evaluations.

### Modified Capabilities


## Impact

- Affects the MOSS adapter, evaluation service request validation, Electron IPC contract, renderer workflow, result presentation, safety verifier, core task pack, tests, documentation, and Windows package.
- Adds one non-secret authorization boolean to the run request; model API secrets remain memory-only and redacted.
- Existing run artifacts remain readable, and the new diagnostics must improve their presentation without migrating stored data.
