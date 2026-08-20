## ADDED Requirements

### Requirement: Hardened initial task suite
The release-gated MVP suite SHALL contain 15 to 20 reviewed P0 tasks covering supported coding-repository and Harness behaviors, and each task MUST declare setup, capability requirements, success invariants, deterministic grader, budgets, allowed variability, telemetry needs, and fixture provenance.

#### Scenario: Add a task to the release suite
- **WHEN** a task is proposed for the release-gated suite
- **THEN** CI rejects it until its schema, fixtures, deterministic Oracle, positive control, negative control, and reviewer metadata are complete

#### Scenario: Run the broader experimental suite
- **WHEN** a user chooses tasks outside the hardened P0 set
- **THEN** the report labels those tasks experimental and separates them from release-gate aggregates

### Requirement: Outcome-first grading
The system SHALL determine task success primarily from the final output and final sandbox state using deterministic semantic graders, while using transcript assertions for capability validation, safety enforcement, and failure diagnosis rather than rigidly requiring one exact valid path.

#### Scenario: Agent takes an alternate valid path
- **WHEN** a trial reaches all declared success invariants without violating constraints through a different valid action sequence
- **THEN** its outcome grader passes and diagnostic path metrics describe the difference without overriding success

#### Scenario: Receipt exists but semantic result is wrong
- **WHEN** a trial emits expected receipt or evidence fields but fails the task's final-state invariant
- **THEN** the outcome grader fails the trial and does not award success for formatting alone

### Requirement: Tool-call metrics from observed events
The system SHALL derive tool-call format validity, name correctness, argument correctness, precision, recall, F1, ordering constraints, redundancy, and efficiency only from validated observed events matched against task-specific acceptable tool expectations.

#### Scenario: Tool event stream is absent
- **WHEN** a trial has no eligible L1 tool telemetry
- **THEN** tool-call metrics are unavailable and the report explains the missing telemetry level

#### Scenario: Multiple tool paths are allowed
- **WHEN** a task defines multiple acceptable tool strategies
- **THEN** the grader matches the observed trace against any valid strategy and does not require a single hard-coded sequence

### Requirement: Optional calibrated LLM judging
The system SHALL use LLM-as-Judge only for declared qualitative dimensions not adequately covered by deterministic graders, SHALL store structured rubric versions and partial-credit scales without string coercion, and SHALL support an explicit uncertain result.

#### Scenario: Run an LLM rubric
- **WHEN** a task enables LLM judging and the user has configured and authorized a judge provider
- **THEN** the system sends only disclosed redacted fields, records model and rubric provenance, and reports judge score separately from deterministic pass status

#### Scenario: Judge is unavailable or uncertain
- **WHEN** the judge cannot run or returns the rubric's uncertain outcome
- **THEN** deterministic grading still completes and the judge dimension is marked unavailable or uncertain rather than silently failed or passed

### Requirement: Judge calibration and privacy
LLM judge rubrics SHALL be calibrated against a versioned human-labeled sample before release use, and the client SHALL obtain explicit disclosure-based consent before sending source, prompts, outputs, or traces to an external judge provider.

#### Scenario: Calibration falls below threshold
- **WHEN** a judge rubric's agreement or error threshold fails the configured calibration gate
- **THEN** the rubric is excluded from release decisions until recalibrated

#### Scenario: User declines external disclosure
- **WHEN** the user does not authorize external judge data transfer
- **THEN** the evaluation runs deterministic graders only and records that judge metrics were intentionally omitted

### Requirement: Regression and release gates
CI SHALL run schema, unit, positive/negative control, artifact compatibility, sandbox-policy, packaged smoke, and selected end-to-end tests; release evaluation SHALL compare candidate and baseline with declared traffic-light thresholds, confidence, task coverage, and no hidden denominator changes.

#### Scenario: Core pass metric regresses beyond threshold
- **WHEN** a candidate version's gated metric crosses a configured red threshold on comparable eligible tasks
- **THEN** CI blocks release and identifies affected tasks and statistically relevant uncertainty

#### Scenario: Coverage changes between versions
- **WHEN** a candidate changes task eligibility or telemetry coverage
- **THEN** the gate reports the coverage delta separately and does not present it as an ordinary pass-rate improvement

### Requirement: Provenance-complete reports
Every release-comparable report SHALL identify evaluator and desktop versions, source and target fingerprints, adapter, sandbox policy and image digest, task-suite and grader versions, run configuration, telemetry coverage, environment fingerprint, and known data-quality warnings.

#### Scenario: Required provenance is missing
- **WHEN** a run lacks a required provenance field for a release-comparable metric
- **THEN** the report remains inspectable but is marked non-comparable and cannot satisfy a release gate
