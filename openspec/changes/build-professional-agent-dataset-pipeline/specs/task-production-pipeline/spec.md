## ADDED Requirements

### Requirement: Candidate ingestion is deterministic
The pipeline SHALL load task cards in stable order, resolve paths within the dataset root, normalize machine-readable content, compute content digests and reject duplicate task versions, escaping paths, vendor directories, `.git` directories and undeclared files.

#### Scenario: Candidate is ingested twice
- **WHEN** two cards declare the same task ID and version
- **THEN** ingestion fails and identifies both candidate locations

#### Scenario: Fixture path escapes dataset root
- **WHEN** a card references a fixture, control or Oracle path outside its allowed root
- **THEN** ingestion fails before copying or executing content

### Requirement: Every control is materialized in isolation
For each control the pipeline SHALL create a fresh copy of the pristine fixture, apply only that control's overlay, invoke the production Oracle and persist expected-versus-actual evidence. No control workspace SHALL be reused.

#### Scenario: Negative control is declared
- **WHEN** calibration runs for a task with five controls
- **THEN** all five controls execute in separate workspaces and the report includes a result for each control ID

#### Scenario: Control execution errors
- **WHEN** an Oracle crashes, times out or cannot read its workspace
- **THEN** the control is an error and promotion fails rather than treating the expected rejection as success

### Requirement: Oracle assets are absent during Agent execution
For a professional task marked `evaluator-only`, the Agent-phase runtime MUST NOT mount the task directory, evaluation repository or Oracle bundle. Oracle execution SHALL occur only after Agent termination in a fresh grader phase with read-only Oracle access.

#### Scenario: Professional Agent command starts
- **WHEN** the runner launches an Agent for an evaluator-only task
- **THEN** the recorded Agent mount policy contains no task, evaluator or Oracle mount

#### Scenario: Grader starts
- **WHEN** the Agent process has ended and grading begins
- **THEN** a fresh grader execution receives the workspace and read-only Oracle assets required for verification

### Requirement: Pipeline states are evidence-derived
The pipeline SHALL derive candidate, calibrated, reviewed, pilot and release-eligible states from stored evidence and SHALL never trust a task-authored status as proof.

#### Scenario: Calibration passes without reviews
- **WHEN** all controls pass but independent reviews are absent
- **THEN** the task is reported as calibrated but not reviewed or release-eligible

### Requirement: Reports are reproducible and redacted
Audit and calibration commands SHALL write JSON and human-readable reports containing tool version, timestamps, task versions, input digests, decisions and blocking reasons while redacting configured secrets and avoiding raw sensitive source content.

#### Scenario: Same inputs are rerun
- **WHEN** unchanged dataset inputs are audited on a compatible platform
- **THEN** the content digest and gate decisions are identical aside from timestamps and output paths
