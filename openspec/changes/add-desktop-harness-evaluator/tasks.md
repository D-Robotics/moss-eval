## 1. Baseline and Schema Stabilization

- [x] 1.1 Add compatibility fixtures for current valid CLI run/trial artifacts and document the canonical `trials/<task>/<agent>/trial-<n>` layout.
- [x] 1.2 Replace second-precision run IDs with collision-resistant IDs and add concurrent-creation tests.
- [x] 1.3 Isolate adapter, runner, telemetry, and grader exceptions per trial while preserving explicit run-wide invariant failures.
- [x] 1.4 Preserve unknown latency, token, and cost values as null with coverage metadata instead of aggregating them as zero.
- [x] 1.5 Validate and persist structured LLM rubric objects without string coercion and add schema regression tests.
- [x] 1.6 Add versioned canonical artifact readers shared by CLI and desktop, including unsupported-version and legacy-layout diagnostics.

## 2. Storage and Source Ingestion

- [x] 2.1 Implement a platform path service for config, sources, targets, runs, cache, and logs with development and packaged-mode tests.
- [x] 2.2 Define and validate `SourceRecord`, exclusion policy, snapshot manifest, and source fingerprint schemas.
- [x] 2.3 Implement GitHub URL normalization, provider validation, ref-to-full-SHA resolution, and bounded public repository cloning.
- [x] 2.4 Implement streaming local-directory snapshot copy with file-count, byte, file-size, path, symlink/junction, and traversal protections.
- [x] 2.5 Detect local Git revision and dirty state without mutating the worktree and include actual snapshot content in the fingerprint.
- [x] 2.6 Add snapshot deduplication, refresh, retention hooks, and tests proving later source changes do not alter an existing snapshot.

## 3. Harness Inspection and Configuration

- [x] 3.1 Define schemas for inspection evidence, Harness candidates, target profiles, adapter identity, capabilities, and telemetry levels.
- [x] 3.2 Implement the non-executing static inspection pipeline and evidence/confidence reporting.
- [x] 3.3 Implement the built-in MOSS detector with positive, negative, and ambiguous repository fixtures.
- [x] 3.4 Define and publish the versioned `.moss-eval/harness.json` schema with safe path and privilege validation.
- [x] 3.5 Implement manifest discovery, validation, effective-configuration projection, and unsupported-version errors.
- [x] 3.6 Implement source-fingerprint-bound guided target profiles and stale-profile validation.
- [x] 3.7 Build the desktop inspection and guided-configuration screens with explicit user review before preparation.

## 4. Adapter and Prepared-Target Core

- [x] 4.1 Define the versioned adapter registry/conformance API for compatibility, inspection, preparation, launch, telemetry, capabilities, and fingerprinting.
- [x] 4.2 Refactor MOSS-specific source-track preparation and native telemetry behind the built-in MOSS adapter.
- [x] 4.3 Implement the trusted manifest adapter without dynamically importing repository code into evaluator processes.
- [x] 4.4 Define and validate prepared-target manifests including source, adapter/configuration, policy, runtime, image digest, and capability provenance.
- [x] 4.5 Implement deterministic prepared-target fingerprinting, immutable digest launch, cache validation, and invalidation tests.
- [x] 4.6 Add adapter conformance fixtures and prove equivalent controlled MOSS cases work through CLI and the new adapter path.

## 5. Sandbox, Authorization, and Environment Doctor

- [x] 5.1 Implement Windows prerequisite checks for OS/architecture, disk, virtualization, WSL2, Docker tooling, daemon health, and runtime compatibility.
- [x] 5.2 Create evaluator-owned preparation and trial sandbox policies denying privileged mode, host namespaces, Docker socket, and broad host mounts.
- [x] 5.3 Enforce CPU, memory, PID, disk, wall-time, network, writable-path, and artifact-egress budgets with structured breach results.
- [x] 5.4 Implement explicit scoped network and named-secret authorization records, separating source-clone and target-runtime credentials.
- [x] 5.5 Add redaction across process output, normalized events, raw traces, UI projections, logs, and exported reports.
- [x] 5.6 Implement cooperative cancellation, bounded forced termination, cleanup, and evaluator-owned resource reconciliation after crashes.
- [x] 5.7 Add adversarial tests for traversal, symlink escape, prohibited mounts/privileges, secret leakage, denied network, and sandbox unavailability.

## 6. Capability-Aware Scheduling and Metrics

- [x] 6.1 Extend task schemas with versioned capability, environment, protocol, tool, telemetry, budget, and experimental/gated declarations.
- [x] 6.2 Implement preflight capability matching and persist `eligible` or `NOT_APPLICABLE` decisions with evidence.
- [x] 6.3 Normalize MOSS events into L0–L3 telemetry with validation, raw-event references, and achieved-level coverage.
- [x] 6.4 Gate outcome, tool, token/model, lifecycle, latency, cost, safety, recovery, and efficiency metrics on their required data.
- [x] 6.5 Add task/telemetry/cost coverage, explicit denominators, confidence intervals, and unavailable reasons to summaries.
- [x] 6.6 Implement comparison on common eligible task intersections with separate total-coverage and eligibility-delta views.
- [x] 6.7 Add scheduler tests for repetitions, pass@1/pass@k/pass^k, cancellation, independent trial failures, and run-wide aborts.

## 7. Evaluation Quality Gates

- [x] 7.1 Inventory the existing task set and select 15–20 realistic P0 candidates for the gated MVP suite.
- [x] 7.2 Replace receipt-only success checks in selected tasks with semantic final-output or final-sandbox-state Oracles.
- [x] 7.3 Add allowed alternate paths, task-specific tool expectations, positive controls, negative controls, fixture provenance, and reviewer metadata.
- [x] 7.4 Mark all non-hardened tasks experimental and separate their aggregates from release-gated metrics.
- [x] 7.5 Implement trace-derived tool format/name/argument/precision/recall/F1/order/redundancy/efficiency graders with telemetry eligibility.
- [x] 7.6 Implement optional structured LLM judge execution with partial credit, uncertain, provider/model/rubric provenance, consent, and redacted field disclosure.
- [x] 7.7 Add human-label calibration datasets and CI thresholds before any LLM rubric can influence a release gate.
- [x] 7.8 Define baseline comparison traffic-light thresholds, coverage-change handling, and provenance completeness requirements.

## 8. Desktop Service and Security

- [x] 8.1 Extract shared core services for inspect, prepare, start, cancel, query/list runs, and export without CLI text parsing.
- [x] 8.2 Implement a packaged-compatible dedicated evaluation worker and versioned handshake using Electron-supported process APIs.
- [x] 8.3 Replace broad IPC with a schema-validated preload API and identifier-scoped cancellation, settings, and file-selection operations.
- [x] 8.4 Remove arbitrary renderer filesystem/process capabilities and add negative IPC authorization tests.
- [x] 8.5 Implement append-safe worker event persistence and bounded live projections that survive renderer reload and window closure.
- [x] 8.6 Enforce context isolation, renderer sandbox, disabled Node integration, restrictive CSP, inert untrusted text rendering, and blocked remote navigation.
- [x] 8.7 Add desktop security tests for injected trace/source markup, invalid IPC payloads, path escape, arbitrary PID cancellation, and remote navigation.

## 9. Desktop Workflow, Status, History, and Reports

- [x] 9.1 Build source selection for GitHub URL and local directory with resolved revision/snapshot provenance review.
- [x] 9.2 Build preparation authorization and progress views including doctor state, effective sandbox policy, network, secrets, budgets, and cancellation.
- [x] 9.3 Build task-suite, eligibility, repetition, randomization, and telemetry-coverage configuration views.
- [x] 9.4 Build the live terminal/dashboard showing run counts, phase, active trial, budgets, recent outcomes, telemetry, and unavailable reasons.
- [x] 9.5 Build report drill-down for outcomes, transcript diagnostics, failures, artifacts, metric definitions, denominators, and provenance.
- [x] 9.6 Build history reconstruction from canonical artifacts and mark completed, interrupted, cancelled, corrupt, and unsupported-schema runs accurately.
- [x] 9.7 Build coverage-aware comparison and redacted JSON plus human-readable report export.
- [x] 9.8 Add an end-to-end desktop fixture that evaluates a pinned public-style MOSS source and a local snapshot without modifying its original directory.

## 10. Packaging, CI, and Release

- [x] 10.1 Correct packaged resource lookup to use the runtime resources directory and remove development-path assumptions.
- [x] 10.2 Configure NSIS and portable outputs with locked dependencies, application/core version metadata, checksums, and build provenance.
- [x] 10.3 Update ignore and packaging rules so dependencies, generated distributions, runs, caches, credentials, and local settings are not committed or unintentionally shipped.
- [x] 10.4 Add clean-checkout packaging and packaged smoke tests for resource lookup, worker handshake, user-data writes, inspection, and canonical artifact reading.
- [x] 10.5 Add CI gates for schemas, core units, artifact compatibility, adapter conformance, grader controls, sandbox policy, desktop security, and selected end-to-end evaluations.
- [x] 10.6 Document supported inputs, prerequisites, security/permission model, data locations, telemetry levels, metric semantics, limitations, and troubleshooting.
- [ ] 10.7 Run the full release checklist against a clean Windows environment and publish only when provenance, coverage, regression, security, and packaged smoke gates pass.
