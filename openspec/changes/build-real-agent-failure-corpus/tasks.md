## 1. Failure registry contracts

- [x] 1.1 Define and validate the registry manifest, case, evidence, reproduction, minimization, task-mapping, review, and Pilot contracts
- [x] 1.2 Implement safe relative-path, stable ID/version, source authorization, privacy, contamination, and corpus-stratum validation
- [x] 1.3 Implement evidence-derived case states and blocker reason codes
- [x] 1.4 Add contract fixtures and unit tests for valid, invalid, private, and ordinary-product-defect cases

## 2. Registry audit and reporting

- [x] 2.1 Implement canonical case, evidence, artifact, and corpus digests with drift detection
- [x] 2.2 Implement secret scanning, undeclared-file checks, evidence requirements, and accepted-count claim boundaries
- [x] 2.3 Implement exact duplicate detection and root-cause-family grouping without double counting
- [x] 2.4 Implement coverage reports by stratum, category, construct, source project, root-cause family, and lifecycle state
- [x] 2.5 Write JSON and Markdown audit reports and add audit unit tests

## 3. Reproduction and task production

- [x] 3.1 Define a bounded command reproduction driver with isolated workspace, pinned environment, signatures, receipts, and no source-checkout mutation
- [x] 3.2 Implement reproduction eligibility checks, explicit execution authorization, and non-reproduction reason codes
- [x] 3.3 Implement minimization receipts that compare original and minimized failure mechanisms
- [x] 3.4 Implement track-specific promotion mappings into the existing professional Task Card pipeline
- [x] 3.5 Enforce deterministic outcome-first Oracles, task-specific 2-positive/3-negative controls, and Agent/grader evidence isolation
- [x] 3.6 Add reproduction, minimization, promotion, and Oracle-isolation tests

## 4. CLI, CI, and documentation

- [x] 4.1 Add `failure-audit`, `failure-reproduce`, and `failure-promote` CLI commands with machine-readable output and fail-closed exit codes
- [x] 4.2 Add npm scripts, example configuration, and CI gates for registry audit and blocked public release
- [x] 4.3 Document collection, triage, reproduction, minimization, review, Pilot, private-evidence, rejection, and claim policies
- [x] 4.4 Add end-to-end tests covering candidate registration through calibrated task mapping

## 5. Initial evidence-backed pilot

- [x] 5.1 Search approved authoritative public sources and local retained Traces, then register at least ten raw candidates with immutable evidence identity
- [x] 5.2 Triage candidates and retain explicit rejection records for ordinary bugs, insufficient evidence, duplicates, licensing, privacy, or non-reproduction
- [x] 5.3 Select five distinct evidence-backed pilot cases spanning Agent behavior and Harness behavior without mixing their scores
- [x] 5.4 Reproduce each selected case at a pinned revision in isolation and record successful or failed reproduction receipts honestly
- [x] 5.5 Minimize successfully reproduced cases and promote only eligible cases to target-regression, Harness-regression, or general-capability tasks
- [x] 5.6 Calibrate promoted tasks with two positive and three task-specific negative controls each

## 6. Validation and scale readiness

- [x] 6.1 Run registry audit, reproduction tests, professional calibration, release-blocked checks, and the full repository test suite
- [x] 6.2 Validate the OpenSpec change strictly and publish pilot coverage, accepted/rejected counts, blockers, and corpus digest
- [x] 6.3 Document the reviewed batch-of-five expansion plan and gates for reaching 20 accepted cases before considering 50
