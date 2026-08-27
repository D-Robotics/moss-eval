## Why

The desktop evaluation setup screen gives secondary runtime diagnostics too much visual weight, while the source, model connection, and start controls that users must complete are spread across a long page. Users cannot quickly tell what is required, what is optional, or what to do when a step is incomplete.

## What Changes

- Reorganize evaluation setup into a compact primary configuration flow with clear source, model, and run sections.
- Replace the oversized local-runtime area with a compact status summary and expandable diagnostic details.
- Keep required controls and the primary action visible in a balanced desktop layout without hiding validation context.
- Add contextual step status, field-level guidance, and actionable error messages when prerequisites are incomplete.
- Preserve existing evaluation behavior, security authorization, and runtime checks while changing presentation and interaction hierarchy.

## Capabilities

### New Capabilities

- `evaluation-configuration-layout`: Defines a compact, progressive, and accessible desktop configuration experience for preparing and starting an Agent evaluation.

### Modified Capabilities

None.

## Impact

- Affects `app/renderer/index.html`, `app/renderer/style.css`, and renderer workflow behavior.
- Updates desktop renderer and packaged smoke tests that assert configuration-page structure and interaction states.
- Does not change evaluation APIs, task semantics, credentials handling, Docker policy, or result scoring.
