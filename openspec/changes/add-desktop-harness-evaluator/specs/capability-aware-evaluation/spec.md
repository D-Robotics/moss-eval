## ADDED Requirements

### Requirement: Capability-based task eligibility
The system SHALL represent task requirements and prepared-target capabilities as versioned machine-readable declarations and SHALL compute eligibility before scheduling trials.

#### Scenario: Target satisfies a task
- **WHEN** a target provides every required interaction, tool, environment, and telemetry capability for a task
- **THEN** the task is eligible and the report records the matching capability evidence

#### Scenario: Target lacks a required capability
- **WHEN** a target lacks one or more required capabilities
- **THEN** the task is reported as `NOT_APPLICABLE` with missing capabilities and is excluded from pass-rate denominators

### Requirement: Telemetry levels
The system SHALL classify each trial's observable data as L0 outcome, L1 structured tool calls, L2 model/token/timing data, or L3 lifecycle events, and SHALL compute a metric only when its required telemetry is present and valid.

#### Scenario: Outcome-only Harness
- **WHEN** a Harness provides final state and output but no structured tool trace
- **THEN** outcome metrics remain eligible while tool-call and lifecycle metrics are reported unavailable rather than zero

#### Scenario: Native MOSS telemetry is available
- **WHEN** the MOSS adapter collects valid native events through the supported instrumentation contract
- **THEN** the report records the achieved telemetry level and enables only metrics supported by those events

### Requirement: Canonical trial artifacts
The system SHALL use one versioned canonical run schema for CLI and desktop readers and writers, with each trial stored under `runs/<run-id>/trials/<task-id>/<agent-id>/trial-<n>/` and referenced by the run summary.

#### Scenario: Desktop opens a completed CLI run
- **WHEN** a desktop client opens a compatible run created by the CLI
- **THEN** task, trial, metric, trace, and artifact data match the canonical files without relying on a legacy directory layout

#### Scenario: Unsupported artifact schema
- **WHEN** a run uses a newer unsupported schema version
- **THEN** the reader preserves the files, refuses unsafe interpretation, and reports the required reader version

### Requirement: Trial failure isolation
The system SHALL convert an unexpected adapter, runner, telemetry, or grader error into a structured result for the affected trial and SHALL continue other schedulable trials unless a run-wide invariant is compromised.

#### Scenario: One trial throws an exception
- **WHEN** one trial worker throws an unexpected exception
- **THEN** that trial is marked failed or invalid with diagnostic attribution and independent trials continue

#### Scenario: Run-wide invariant fails
- **WHEN** the prepared target becomes unverifiable or canonical artifact storage is unavailable
- **THEN** the scheduler stops new trials, safely terminates active work, and marks the run with the run-wide failure reason

### Requirement: Coverage-aware metrics and comparison
The system SHALL report valid-trial rate, outcome pass rate, trial success rate, pass@1, pass@k, pass^k, safety violations, recovery, latency, resource usage, tool metrics when eligible, cost when known, category results, failure categories, and task coverage with denominators and confidence intervals where defined. Comparative scores MUST use the common eligible task intersection or present separate coverage-normalized views.

#### Scenario: Cost data is unavailable
- **WHEN** one or more trials do not report cost
- **THEN** the system reports cost coverage and unknown cost values and does not coerce missing cost to zero

#### Scenario: Compare targets with different capabilities
- **WHEN** two targets have different eligible task sets
- **THEN** the comparison prominently shows each coverage set and bases head-to-head pass metrics on their common eligible tasks

### Requirement: Run identity, repetition, and cancellation
The system SHALL create collision-resistant run and trial identifiers, preserve configured repetition count and randomization settings, and support cancelling pending and active trials without corrupting completed artifacts.

#### Scenario: Two runs start concurrently
- **WHEN** two evaluations start within the same clock second
- **THEN** they receive distinct run identifiers and directories

#### Scenario: Cancel an active run
- **WHEN** the user cancels a run
- **THEN** no new trials start, active trials are terminated within a bounded interval, completed results remain readable, and remaining trials are marked cancelled
