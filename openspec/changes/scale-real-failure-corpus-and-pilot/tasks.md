## 1. Catalog and Schema Migration

- [x] 1.1 Define versioned catalog, reproduction, minimization, review-packet, sign-off, protocol, hidden-bundle, and release-decision schemas
- [x] 1.2 Move the five accepted pilot definitions into a data-driven catalog without changing task semantics
- [x] 1.3 Add catalog loading, canonical digesting, and accepted-case/task mapping validation
- [x] 1.4 Add unit tests for incomplete lineage, duplicate mechanisms, orphan tasks, and digest stability

## 2. Twenty-Case Real-Failure Corpus

- [x] 2.1 Triage source-backed candidate changes and document explicit inclusion or rejection decisions
- [x] 2.2 Add five accepted cases for tool execution, policy, and verifier failures with pinned source evidence
- [x] 2.3 Add five accepted cases for rollback, provider, process, and platform failures with pinned source evidence
- [x] 2.4 Add five accepted cases for planning, context, safety, and state-management failures with pinned source evidence
- [x] 2.5 Produce read-only source reproduction receipts and content identities for all 20 accepted cases
- [x] 2.6 Produce minimized fixtures and one-to-one task mappings for all 20 accepted cases
- [x] 2.7 Enforce corpus size and concentration coverage gates and generate a coverage report

## 3. Task Generation and Calibration

- [x] 3.1 Refactor pilot generation to consume the catalog and preserve isolated task/Oracle workspaces
- [x] 3.2 Implement task-specific deterministic Oracles for the 15 added cases
- [x] 3.3 Add a known-good, original-failure, and at least three plausible wrong-answer controls per task
- [x] 3.4 Run all controls and write digest-bound calibration receipts
- [x] 3.5 Add regression tests for object-key/path evidence, Oracle leakage, and control bypasses

## 4. Review and Sign-Off Workflow

- [x] 4.1 Generate stable per-case and corpus review packets with commands, evidence, hashes, diffs, controls, and checklists
- [x] 4.2 Implement detached sign-off validation bound to artifact digests and reviewer roles
- [x] 4.3 Enforce distinct dataset/Oracle reviewer and release-owner identities
- [x] 4.4 Prove missing, stale, malformed, and same-identity sign-offs fail closed without blocking development runs

## 5. Cross-Agent Pilot

- [x] 5.1 Define canonical frozen protocol manifests and protocol digesting
- [x] 5.2 Implement adapter qualification checks and infrastructure-invalid result classification
- [x] 5.3 Qualify the MOSS adapter and run the frozen 20-case development pilot
- [ ] 5.4 Qualify and run a Claude-family adapter under the same protocol
- [ ] 5.5 Qualify and run a third independently implemented agent family under the same protocol
- [x] 5.6 Aggregate only protocol-compatible runs and report pass@1, pass@k, pass^k, confidence intervals, cost, latency, telemetry validity, and sample sizes

## 6. Hidden Oracle and Release Gates

- [x] 6.1 Define the gitignored private-bundle layout and non-disclosing salted manifest
- [x] 6.2 Implement hidden-bundle validation and isolated release execution
- [x] 6.3 Audit tracked, packaged, agent-visible, and run-artifact files for hidden content and secrets
- [x] 6.4 Implement the machine-readable fail-closed release evaluator with all required gates and evidence digests
- [x] 6.5 Add CI fixtures proving development success cannot bypass hidden-run or human-review requirements

## 7. CLI, Desktop, and Documentation

- [x] 7.1 Add CLI commands for corpus audit, review packets, adapter qualification, protocol runs, and release status
- [x] 7.2 Show development/release status, plain-language metrics, uncertainty, comparability, and prioritized blockers in terminal output
- [x] 7.3 Show the same release artifact and progressive evidence details in the desktop client
- [x] 7.4 Preserve dataset, protocol, source, adapter, environment, run, and release-decision identities in exported reports
- [x] 7.5 Document dataset locations, contribution/review workflow, cross-agent protocol, private-bundle operations, and interpretation limits

## 8. Verification and Delivery

- [x] 8.1 Run strict OpenSpec validation, syntax checks, unit/integration tests, dataset audits, and all calibration controls
- [x] 8.2 Run secret scans and verify source worktree preservation across reproduction
- [ ] 8.3 Run packaged Windows client smoke tests and the clean-environment release checklist
- [ ] 8.4 Review the complete diff, commit the implementation, push it, and confirm remote CI status
