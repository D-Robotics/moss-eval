## 1. Workflow State and Navigation

- [x] 1.1 Add testable workflow-readiness and navigation-guard helpers for the three primary steps.
- [x] 1.2 Replace peer primary tabs with numbered guided steps while retaining history and reports as secondary navigation.

## 2. User-Friendly Source Experience

- [x] 2.1 Rebuild Step 1 around GitHub/local source modes, plain-language safety assurance, and advanced revision disclosure.
- [x] 2.2 Add staged import/inspection feedback, duplicate-click prevention, a concise Agent readiness result, and a clear `继续配置评测` action.
- [x] 2.3 Move source fingerprints, provenance, adapter evidence, entry-point diagnostics, and raw JSON into expandable technical details.

## 3. Feedback, Validation, and Recovery

- [x] 3.1 Add reusable busy/success/failure action feedback with accessible live status and duplicate-action prevention.
- [x] 3.2 Add inline field and step validation with focus management and user-facing mappings for source, environment, model, network, and connection errors.
- [x] 3.3 Preserve non-secret configuration after recoverable failures while keeping API keys out of drafts and restored UI state.
- [x] 3.4 Update Step 2 and Step 3 wording and empty states so preparation, run startup, live progress, and next actions are explicit.

## 4. Verification and Distribution

- [x] 4.1 Add unit and desktop workflow tests for readiness transitions, navigation guards, validation, busy states, retries, and credential non-persistence.
- [x] 4.2 Extend packaged-renderer smoke coverage for the three-step journey and user-facing source interaction.
- [x] 4.3 Update desktop documentation, run the full test suite and OpenSpec validation, then rebuild and smoke-test Windows packages.

## 5. Minimal Model Service Configuration

- [x] 5.1 Add automatic OpenAI-compatible/Anthropic protocol resolution while retaining compatibility with legacy provider-shaped IPC requests.
- [x] 5.2 Replace the provider-first MOSS form with Base URL, API Key, and model name plus an advanced protocol override.
- [x] 5.3 Ensure generic runtime-secret controls are actually hidden for MOSS and add renderer regression coverage.
- [x] 5.4 Add core, IPC, workflow, and packaged-client tests for protocol inference, custom URLs, and credential non-persistence.
- [x] 5.5 Verify the user-supplied custom endpoint through the connection path without storing or logging its API key.
- [x] 5.6 Rebuild, smoke-test, reinstall, and launch the Windows desktop client.
