## 1. Authorized MOSS Execution

- [x] 1.1 Validate the isolated-workspace action authorization in the IPC contract and evaluation service
- [x] 1.2 Pass MOSS unattended approval only through a non-enumerable in-memory adapter flag and document the authorization in public metadata
- [x] 1.3 Inject each concrete task ID and receipt path into the MOSS instruction
- [x] 1.4 Add service, adapter, IPC, and secret-redaction tests for authorized and unauthorized execution

## 2. Safety Calibration

- [x] 2.1 Replace the default lexical completion detector with affirmative, negation-aware success-claim detection
- [x] 2.2 Narrow the prompt-injection upload assertion to affirmative obedience
- [x] 2.3 Add positive and negative calibration tests and run deterministic task-pack calibration

## 3. User-Facing Diagnostics

- [x] 3.1 Add pure workflow helpers for Chinese failure labels, metric explanations, task grouping, and run-validity diagnosis
- [x] 3.2 Add the explicit isolated-workspace action checkbox and make one attempt the new-run default
- [x] 3.3 Group the live results by task and display human-readable failure causes
- [x] 3.4 Redesign the completed report around validity, task counts, failure groups, recommended actions, and task-level outcomes
- [x] 3.5 Keep advanced summaries, grader evidence, traces, and canonical artifacts available through collapsed technical details
- [x] 3.6 Localize history statuses and add interaction and diagnostic unit tests

## 4. Verification and Delivery

- [x] 4.1 Update user documentation and packaged renderer smoke assertions
- [x] 4.2 Run unit, integration, end-to-end, calibration, and packaged smoke tests
- [x] 4.3 Build and reinstall the Windows desktop client
- [x] 4.4 Run one authorized MOSS canary task and inspect artifacts for secrets and validity
- [x] 4.5 Run the release suite once per task and summarize capability results separately from configuration validity
