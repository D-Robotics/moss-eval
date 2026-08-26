## ADDED Requirements

### Requirement: Isolated reproduction contract
The system MUST require a pinned target revision, declared environment, deterministic setup, trigger, expected failure signature, expected corrected behavior, and bounded execution before a failure is considered reproduced. Reproduction SHALL run in a fresh workspace and MUST NOT mutate the user's source checkout.

#### Scenario: Failure reproduces at the pinned revision
- **WHEN** the trigger produces the registered failure signature in a fresh isolated workspace at the pinned revision
- **THEN** the system records a successful reproduction receipt, environment fingerprint, artifact digest, duration, and observed signature

#### Scenario: Failure no longer reproduces
- **WHEN** the trigger completes without the registered signature
- **THEN** the case remains triaged with a non-reproduction reason and cannot be promoted to a scored task

### Requirement: Failure minimization preserves semantics
The production pipeline SHALL create the smallest practical Fixture that preserves the observed failure, expected correction, relevant permissions, and failure mechanism. It MUST record which source details were removed or transformed and why the minimized Fixture remains representative.

#### Scenario: Minimized fixture changes failure mechanism
- **WHEN** the minimized Fixture no longer triggers the original failure mechanism or removes a material constraint
- **THEN** minimization fails and the case remains reproduced but not task-ready

### Requirement: Track-specific promotion
The system MUST promote MOSS-specific regressions to `target-regression`, cross-Agent constructs to `general-capability`, Harness-specific failures to a separately reported Harness regression track, and private authorized failures to `private-business`. Promotion SHALL preserve the source case ID and evidence digest.

#### Scenario: MOSS-only telemetry parsing defect
- **WHEN** the failure depends on a MOSS-specific telemetry contract and is not meaningful for other Agents
- **THEN** the produced task is target-regression or Harness regression and is excluded from general-capability scores

### Requirement: Outcome-first deterministic Oracle
Every promoted case MUST have a deterministic Oracle that scores final output or final environment state, permits multiple legitimate execution paths, produces structured reason codes, and does not treat a fixed tool sequence as the primary success criterion. Transcript assertions SHALL be used for safety, policy, and diagnosis only where the source failure requires them.

#### Scenario: Alternative correct repair
- **WHEN** an Agent reaches the required final behavior through a different valid implementation or tool order
- **THEN** the Oracle accepts it if all behavioral, safety, and evidence constraints pass

#### Scenario: False success claim
- **WHEN** the Agent claims completion but the final behavior or required receipt is incorrect
- **THEN** the Oracle rejects the trial with a task-specific reason code

### Requirement: Positive and negative control calibration
Every promoted case MUST include at least two materially distinct positive controls and three source-specific negative controls before calibration can pass. Controls SHALL run in unique temporary workspaces, and the Oracle MUST neither mutate the workspace nor misclassify any registered control.

#### Scenario: Generic negative control is not representative
- **WHEN** a negative control merely omits all output or otherwise does not model a credible failure for the case
- **THEN** the production audit blocks task readiness until a task-specific failure control is supplied

#### Scenario: Calibration is exact
- **WHEN** all positive and negative controls execute successfully in isolation
- **THEN** calibration passes only if positive false negatives, negative false positives, Oracle mutations, and execution errors are all zero

### Requirement: Oracle and evidence isolation
The Agent phase MUST NOT mount reproduction evidence, task cards, evaluator implementation, hidden evidence, or Oracle code. The grader phase SHALL receive only the minimum read-only evaluator material required to score the final workspace, and both mount policies MUST be retained in trial artifacts.

#### Scenario: Agent attempts to inspect Oracle
- **WHEN** the Agent lists its available mounts during a scored trial
- **THEN** no task, evaluator, evidence, or Oracle mount is visible in the Agent phase

### Requirement: Independent review and cross-Agent pilot
General-capability promotion MUST require non-author domain and evaluation reviews plus a cross-Agent pilot using at least three Agent families, at least nine valid observations per task, and at least three attempts per tested configuration. Pilot analysis SHALL report difficulty, discrimination, pass@k, pass^k, invalidity, and failure taxonomy.

#### Scenario: Single-Agent success
- **WHEN** only MOSS has run a task successfully
- **THEN** the result is reported as a target development canary and does not establish general-capability validity

### Requirement: Hidden holdout and release claims
A Professional score MUST require an externally retained hidden Oracle or holdout bundle pinned by digest, complete independent reviews, passed calibration, and a qualifying pilot. Public reproduction tasks MAY be used for development and regression but MUST be labeled contaminated for public scoring.

#### Scenario: Public Oracle only
- **WHEN** a case has a public Fixture and public Oracle but no hidden external bundle
- **THEN** release generation remains blocked while development and regression execution remain available
