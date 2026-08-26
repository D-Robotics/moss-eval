## 1. Dataset Contract and Validation

- [x] 1.1 Add professional dataset and task-card validators with track, provenance, privacy, review, contamination, pilot, fixture, Oracle and control requirements
- [x] 1.2 Add safe path resolution, canonical JSON hashing and deterministic directory digest utilities
- [x] 1.3 Derive candidate, calibrated, reviewed, pilot and release-eligible states from evidence instead of trusting authored status
- [x] 1.4 Add contract tests for missing fields, duplicate IDs, escaping paths, author self-review and public-Oracle release rejection

## 2. Quality Audit and Reporting

- [x] 2.1 Implement static audit gates for secrets, undeclared files, digest mismatches, duplicate fixtures and source/privacy evidence
- [x] 2.2 Implement diversity coverage and concentration reporting by track, construct, category, source kind and fixture family
- [x] 2.3 Write deterministic redacted JSON and Markdown audit reports with exact blocking reasons and content digests
- [x] 2.4 Add audit tests proving technical success does not imply professional release eligibility

## 3. Task-Specific Calibration Pipeline

- [x] 3.1 Materialize every positive and negative control in a fresh isolated workspace with safe overlay handling
- [x] 3.2 Execute the production Oracle with timeout and output bounds, treating crashes and timeouts as errors
- [x] 3.3 Report task-specific false-negative, false-positive and execution-error rates and fail closed on any known error
- [x] 3.4 Add calibration tests for alternate correct solutions, plausible task-specific failures and workspace isolation

## 4. Evaluator-Only Oracle Isolation

- [x] 4.1 Add an explicit professional-task Oracle isolation contract to task validation and runtime metadata
- [x] 4.2 Remove task and evaluator mounts from the Agent phase for evaluator-only tasks while preserving required workspace and secret surfaces
- [x] 4.3 Run command graders in a fresh grader phase with read-only evaluator assets and persist phase-specific mount evidence
- [x] 4.4 Add Docker argument and evaluator tests proving the Agent phase cannot see task, evaluator or Oracle roots

## 5. Professional Development Seed Pack

- [x] 5.1 Create independently isolated seed tasks for repository repair, recovery policy and prompt-injection safety with traceable synthetic provenance
- [x] 5.2 Provide at least two materially distinct positive controls and three task-specific negative controls for each seed task
- [x] 5.3 Add behavioral Oracles and ensure no undocumented exact strings or fixed tool sequences are required
- [x] 5.4 Mark public seed Oracles as development-only and prove they cannot generate a hidden scored release

## 6. Release, Pilot and Target Identity Workflow

- [x] 6.1 Add dataset audit, calibrate and release CLI commands and package scripts
- [x] 6.2 Implement immutable release manifests, external hidden-Oracle digest verification and fail-closed manual review requirements
- [x] 6.3 Implement pilot evidence analysis for Agent-family coverage, valid observations, difficulty, discrimination, pass@k and pass^k readiness
- [x] 6.4 Add official target identity resolution and clean pinned snapshot checks that never modify a dirty local checkout
- [x] 6.5 Add tests for content drift, insufficient pilots, dirty local targets and authoritative remote mismatches

## 7. Documentation and CI

- [x] 7.1 Document dataset governance, authoring, review roles, privacy handling, hidden Oracle operations, versioning and claim policy
- [x] 7.2 Add seed dataset technical audit and calibration to CI and require CI to prove professional release remains blocked without manual/private evidence
- [x] 7.3 Update validation and task-authoring documentation to demote the legacy core pack to integration/candidate status

## 8. Compliance Verification and MOSS Validation

- [x] 8.1 Run syntax, unit, integration, end-to-end, OpenSpec and secret-scanning checks
- [x] 8.2 Run professional seed audit and task-specific calibration and inspect all generated evidence
- [x] 8.3 Resolve the official D-Robotics MOSS main commit and prepare a separate clean content-addressed target image without touching the dirty local checkout
- [x] 8.4 Run one real-model MOSS development Canary after all technical gates pass and verify receipt, telemetry, Oracle isolation and secret cleanup
- [x] 8.5 Run a broader scored MOSS suite only if professional release eligibility is established; otherwise record the fail-closed blocker and do not claim a professional score
