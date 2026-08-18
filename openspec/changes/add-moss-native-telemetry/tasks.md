## 1. Native collection

- [x] 1.1 Implement tolerant Session JSONL parsing for state-replace and append-message records
- [x] 1.2 Implement LLM usage JSONL parsing and normalized token/model-call totals
- [x] 1.3 Emit bounded, redacted `native-telemetry.json` without message text or thinking

## 2. Evaluation integration

- [x] 2.1 Collect native telemetry after each agent process and merge it into trial trace metrics
- [x] 2.2 Reconcile Stream/ACP and native tool/usage facts with explicit validity and mismatch diagnostics
- [x] 2.3 Persist telemetry summary/mismatch artifacts and expose trusted metrics in trial and aggregate output

## 3. Tool expectations

- [x] 3.1 Validate optional task `tool_expectations` declarations
- [x] 3.2 Calculate nullable selection precision/recall/F1 and policy violations from observed calls

## 4. Verification and documentation

- [x] 4.1 Add fixtures and unit/E2E tests for parsing, redaction, missing files, mismatches, and tool scoring
- [x] 4.2 Replay the historical real MOSS `code-003` trial and verify 24 calls, 11 model calls, and 153,288 tokens
- [x] 4.3 Update Spec, task authoring, metrics, artifacts, and validation documentation
- [x] 4.4 Run syntax, unit/E2E, OpenSpec validation, and task/config validation gates
