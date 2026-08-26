## ADDED Requirements

### Requirement: Dataset tracks have distinct claims
The system SHALL classify every task as exactly one of `adapter-conformance`, `general-capability`, `target-regression`, or `private-business`, and SHALL exclude adapter-conformance results from capability scores while reporting target-regression separately from target-neutral results.

#### Scenario: Adapter task completes
- **WHEN** an adapter-conformance task passes
- **THEN** the report records compatibility success without increasing the Agent capability pass rate

#### Scenario: Target regression task completes
- **WHEN** a MOSS-specific regression task passes
- **THEN** the report attributes it to the MOSS regression track and does not present it as a target-neutral comparison

### Requirement: Professional task cards are complete and versioned
Every professional task card MUST contain a stable ID and semantic version, track, construct tags, source provenance, license or consent status, redaction status, author identity, public instruction, isolated fixture metadata, Oracle metadata, alternate valid paths, executable controls, review requirements, contamination evidence, pilot requirements, budgets and release state inputs.

#### Scenario: Required evidence is missing
- **WHEN** a task card omits consent or license status, fixture digest, Oracle distribution, controls, reviewers, contamination evidence or pilot requirements
- **THEN** validation fails with field-level blocking reasons

#### Scenario: Task meaning changes
- **WHEN** the instruction, fixture, expected behavior or Oracle semantics change
- **THEN** the task semantic version and dataset content digest MUST change

### Requirement: Provenance and privacy fail closed
The system SHALL require a traceable source kind and reference, an allowed-use basis, a redaction decision and a secret scan for every task. Raw credentials, personal identifiers and non-consented proprietary content MUST prevent promotion.

#### Scenario: Secret-shaped content is detected
- **WHEN** a fixture, control, task card or report contains a credential-shaped value outside an explicitly approved synthetic-canary field
- **THEN** the quality gate fails without reproducing the value in output

#### Scenario: Synthetic task is used
- **WHEN** a task is authored synthetically
- **THEN** provenance identifies it as synthetic and records the construct rationale instead of claiming a production failure source

### Requirement: Oracle quality covers valid alternatives and task-specific failures
A release-eligible task SHALL have at least two materially distinct positive controls and at least three task-specific negative controls, all executed against the same Oracle used for evaluation. The Oracle MUST grade final behavior or state and MUST NOT require an undocumented exact string or fixed tool sequence.

#### Scenario: Equivalent implementation passes
- **WHEN** a declared alternate solution produces behavior satisfying the task invariants
- **THEN** the Oracle accepts it even when its source form or tool path differs from the reference implementation

#### Scenario: Task-specific wrong result is tested
- **WHEN** a declared negative control represents a plausible task-specific error
- **THEN** calibration executes it and the task cannot promote unless the Oracle rejects it

### Requirement: Review evidence is independent
A release-eligible task MUST have approvals from at least two reviewers distinct from the author and from each other, including one domain/construct reviewer and one evaluation/Oracle reviewer. Automation and language models MUST NOT fabricate or substitute these approvals.

#### Scenario: Author self-approves
- **WHEN** a review record uses the task author as reviewer
- **THEN** the review gate fails

#### Scenario: Human review is unavailable
- **WHEN** required independent approval artifacts do not exist
- **THEN** status remains `not-established` or pre-release and no professional release claim is produced

### Requirement: Contamination state is explicit
Each task SHALL record whether its prompt, fixture and Oracle are public, searched against known benchmark sources, or maintained as a hidden holdout. A public development Oracle MUST NOT qualify a task for a hidden scored release.

#### Scenario: Public seed task is audited
- **WHEN** the Oracle is committed in the public repository
- **THEN** the task may pass development calibration but remains ineligible for a hidden professional release
