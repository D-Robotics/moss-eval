## ADDED Requirements

### Requirement: Accepted cases have complete source lineage
The system SHALL count a failure mechanism as accepted only when its record includes an immutable source reference, base and fixed revisions, affected paths, observed failure, reproduction procedure, fix evidence, license/provenance classification, taxonomy, and reviewer status.

#### Scenario: Incomplete evidence is not counted
- **WHEN** a candidate lacks a base revision, fixed revision, reproduction receipt, or affected-path identity
- **THEN** the audit SHALL exclude it from the accepted-case count and emit the missing fields as blockers

#### Scenario: Multiple mechanisms from one change are independent
- **WHEN** two cases cite the same source pull request
- **THEN** each SHALL have a distinct trigger, failure effect, minimized fixture, and Oracle or the duplicate SHALL be rejected

### Requirement: Corpus meets size and coverage gates
The system SHALL require at least 20 accepted mechanisms and SHALL report coverage by root-cause taxonomy, harness component, severity, source change, and source revision.

#### Scenario: Concentrated corpus cannot make a release claim
- **WHEN** the accepted corpus is below 20 cases or exceeds configured concentration limits
- **THEN** development evaluation MAY run but formal release eligibility SHALL be false with quantitative blockers

### Requirement: Every accepted case produces a deterministic task
The system SHALL map every accepted case one-to-one to a runnable task containing a frozen input fixture, expected final state, task-specific deterministic Oracle, resource budget, and public development controls.

#### Scenario: Mapping parity is audited
- **WHEN** corpus and taskpack audits run
- **THEN** the accepted case identifiers and task case identifiers SHALL be identical sets with no orphan or duplicate mappings

### Requirement: Calibration challenges task-specific Oracle behavior
The system SHALL calibrate each public Oracle with a known-good fixture, the original failure fixture, and at least three plausible wrong-answer controls that exercise case-specific bypass risks.

#### Scenario: Weak Oracle blocks dataset release
- **WHEN** any good fixture fails or any wrong-answer control passes
- **THEN** the generated dataset SHALL be marked invalid and its release gate SHALL fail

### Requirement: Source validation is read-only and reproducible
The system SHALL reproduce evidence against pinned source content without changing the user's source worktree and SHALL record command, environment, exit status, expected observation, actual observation, and content identity.

#### Scenario: Dirty source worktree remains unchanged
- **WHEN** source validation runs against a worktree with pre-existing changes
- **THEN** the validator SHALL leave the before/after status identical and SHALL write evidence only under the evaluation project

### Requirement: Human review is digest-bound
The system SHALL generate review packets for accepted cases and SHALL accept a human decision only when the sign-off identifies the reviewer, role, decision, timestamp, and exact reviewed artifact digest.

#### Scenario: Automation cannot self-approve
- **WHEN** review packets exist but no valid independent sign-off is supplied
- **THEN** case production SHALL remain usable for development and human-review release gates SHALL remain blocked

