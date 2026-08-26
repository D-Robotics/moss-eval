## ADDED Requirements

### Requirement: Technical quality gates are fail closed
The dataset audit SHALL fail on schema errors, missing provenance, privacy failures, digest mismatches, duplicate fixtures, missing task-specific controls, Oracle visibility violations, secret findings or non-reproducible inputs.

#### Scenario: One task fails a gate
- **WHEN** any task in a requested release fails a required technical gate
- **THEN** the dataset gate is failed and no partial professional release is silently produced

### Requirement: Calibration measures task-specific Oracle validity
Calibration SHALL report positive-control false-negative rate, negative-control false-positive rate and execution-error rate for task-specific controls. Professional promotion requires zero known positive false negatives, zero known negative false positives and zero unresolved execution errors.

#### Scenario: One alternate solution is rejected
- **WHEN** one declared valid alternate path fails its Oracle
- **THEN** the task is blocked even if the canonical reference passes

### Requirement: Diversity and duplication are audited
The system SHALL report track, construct, category, source-kind and difficulty coverage and SHALL detect exact duplicate fixtures and identical prompt/Oracle combinations. Release policy MUST define maximum concentration thresholds.

#### Scenario: Fixture is reused without justification
- **WHEN** two release candidates have the same fixture digest and no explicit approved family relationship
- **THEN** the diversity gate blocks promotion

### Requirement: Statistical evidence is sufficient before scoring claims
A professional release SHALL define minimum distinct Agent families, configuration fingerprints, valid observations per task and repeated attempts. It SHALL compute task difficulty, discrimination and reliability evidence, and SHALL return `not-established` when thresholds are not met.

#### Scenario: Only MOSS has pilot results
- **WHEN** pilot data contains one Agent family
- **THEN** target validation may be reported as a development run but comparative benchmark validity remains `not-established`

#### Scenario: Task has no outcome variance
- **WHEN** all pilot Agents always pass or always fail a task
- **THEN** the discrimination gate flags the task for review or excludes it according to the release policy

### Requirement: Manual gates remain manual
The system SHALL verify signed or attributable review records but SHALL NOT generate reviewer approvals, consent decisions or domain-validity claims automatically.

#### Scenario: Automated checks are green
- **WHEN** all machine checks pass but manual artifacts are missing
- **THEN** the report lists the exact manual blockers and refuses release eligibility

### Requirement: CI validates development assets without overstating them
CI SHALL execute schema, secret, isolation, digest and control tests for public development assets and SHALL verify that the release command refuses those assets when hidden-Oracle, human-review or pilot evidence is absent.

#### Scenario: Public seed pipeline passes CI
- **WHEN** development controls and all technical tests pass
- **THEN** CI succeeds only if the same dataset remains ineligible for a professional scored release
