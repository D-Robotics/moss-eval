## Why

The desktop client's first-use flow exposes implementation terms such as immutable snapshot, harness candidate, provenance, fingerprint, adapter, and prepared target before users understand what action to take. Important actions also rely on transient technical toasts, so a click can appear ineffective or leave users without a clear explanation of the missing prerequisite and the next corrective action.

## What Changes

- Replace the source/configuration/live navigation with a three-step guided workflow: select an Agent, configure the evaluation, then run and review it.
- Present GitHub and local-folder import in user language, with advanced revision controls hidden until requested and a plain-language assurance that evaluation uses a copy and does not modify the original project.
- Show persistent, accessible progress for source import and Agent detection, followed by a concise readiness summary and a single primary next action.
- Gate later steps using explicit workflow state. When a user chooses a step too early, keep the current page and show the exact prerequisite and recovery action instead of silently navigating or exposing internal error codes.
- Give every asynchronous action an immediate busy state, duplicate-click protection, success state, and recoverable failure state that preserves entered values.
- Move fingerprints, provenance, adapter evidence, raw manifests, sandbox limits, and other expert diagnostics into expandable technical details without removing auditability.
- Simplify MOSS model access to the three values users actually receive from a model service: Base URL, API Key, and model name. Infer the API wire protocol automatically and expose only an advanced protocol override, rather than asking users to choose a vendor.
- Keep generic runtime-secret inputs out of the MOSS configuration surface so users see one unambiguous credential path.
- Add renderer and packaged-client regression coverage for the guided states, feedback, accessible error placement, and non-persistence of API keys.

## Capabilities

### New Capabilities

- `guided-desktop-evaluation-workflow`: User-facing three-step evaluation navigation, progressive disclosure, prerequisite gating, action feedback, and recoverable errors for the desktop client.

### Modified Capabilities

None.

## Impact

- Primary changes are in the Electron renderer, renderer styles, and packaged-renderer smoke coverage.
- Existing source ingestion, static inspection, sandbox preparation, evaluation worker, and artifacts remain the authoritative backend behavior. The model configuration and IPC input contract gain protocol inference while retaining compatibility with legacy provider-shaped requests.
- No stored data schema or evaluation metric changes are required; only non-secret workflow draft state may continue to be persisted.
