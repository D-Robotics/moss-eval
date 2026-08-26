## ADDED Requirements

### Requirement: Run validity precedes capability conclusions
The desktop client SHALL present whether a completed run is suitable for judging Agent capability before presenting pass percentages.

#### Scenario: Systematic approval block
- **WHEN** repeated trials contain strong evidence that MOSS mutation or execution was denied in non-interactive mode and required receipts are missing
- **THEN** the report labels the run inconclusive for Agent capability, explains the configuration cause, and recommends rerunning with isolated-workspace action authorization

#### Scenario: Ordinary evaluated failures
- **WHEN** trials executed without a systematic harness or configuration block
- **THEN** the report treats their grader results as valid capability evidence

### Requirement: Task-oriented result summary
The report SHALL show the number of unique tasks, attempts per task, passed tasks, passed executions, grouped failure causes, and a task-level result list using user-facing Chinese labels.

#### Scenario: Repeated evaluation
- **WHEN** 16 tasks are each attempted 3 times
- **THEN** the report states “16 条任务，每条 3 次，共 48 次执行” and groups repeated results under each task

#### Scenario: Failure category display
- **WHEN** a trial has failure category `budget_exceeded`
- **THEN** the primary view shows a Chinese name, a plain-language meaning, and a recommended next action rather than only the raw identifier

### Requirement: Progressive disclosure of technical metrics
The report SHALL keep canonical summaries, advanced metrics, grader evidence, traces, and raw artifacts accessible but collapsed by default behind clearly named technical-detail controls.

#### Scenario: First report view
- **WHEN** a user opens a completed run
- **THEN** the visible content prioritizes conclusion, counts, causes, and actions without requiring interpretation of raw JSON

#### Scenario: Advanced inspection
- **WHEN** a user expands technical details
- **THEN** the client shows raw metric identifiers, canonical artifacts, grader evidence, and provenance without modifying their values

### Requirement: Explained metrics
Every advanced metric displayed by the desktop report SHALL have a short plain-language explanation and an explicit numerator or denominator when available.

#### Scenario: Pass at k
- **WHEN** pass@k or pass^k is available
- **THEN** the report explains that pass@k means at least one success in k attempts and pass^k means success in all k attempts

#### Scenario: Tool-call metric
- **WHEN** tool precision, recall, or F1 is available
- **THEN** the report explains correct-call proportion, required-call coverage, and their balance respectively

### Requirement: Guided single-round default
The desktop configuration SHALL default new evaluations to one attempt per task while allowing an explicit attempt count from 1 through 20.

#### Scenario: Fresh configuration
- **WHEN** no previous evaluation draft provides an attempt count
- **THEN** the repeat count control displays 1 and explains that higher values measure stability at additional time and model cost
