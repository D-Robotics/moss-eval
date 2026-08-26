## ADDED Requirements

### Requirement: Comparison protocol is frozen and identified
The system SHALL create an immutable protocol manifest containing dataset digest, task selection and order, trial count, budgets, timeouts, concurrency, network policy, execution environment, adapter versions, and declared model/provider identities.

#### Scenario: Protocol drift separates runs
- **WHEN** any protocol field changes between agents or resumed runs
- **THEN** the system SHALL assign a different protocol digest and SHALL NOT aggregate the runs as directly comparable

### Requirement: Adapters qualify before scored execution
Each agent adapter SHALL pass qualification checks for instruction delivery, workspace access, final-state mutation, exit handling, transcript capture, timeout enforcement, and secret cleanup before its trials are eligible for scoring.

#### Scenario: Adapter failure is infrastructure-invalid
- **WHEN** an adapter fails qualification or required authentication is unavailable
- **THEN** the system SHALL report an infrastructure-invalid result and SHALL NOT count it as an agent task failure

### Requirement: Pilot includes independent agent families
A formal cross-agent pilot SHALL include MOSS and at least two independently implemented agent families operating on the same protocol manifest.

#### Scenario: Insufficient families block comparison claim
- **WHEN** fewer than three qualified agent families complete the frozen pilot
- **THEN** individual development results MAY be shown but cross-agent comparison release eligibility SHALL be false

### Requirement: Outcomes and process telemetry remain distinct
The system SHALL score final outcome with isolated deterministic Oracles and SHALL separately report tool calls, model calls, latency, tokens, cost, safety, retries, and telemetry validity without converting missing process telemetry into an outcome failure.

#### Scenario: Telemetry mismatch is visible
- **WHEN** adapter and trace event counts disagree or required event identities are missing
- **THEN** outcome scoring SHALL remain unchanged and telemetry validity SHALL fail with an explicit diagnostic

### Requirement: Statistical claims expose uncertainty and stability
The system SHALL report per-task pass@1, pass@k, pass^k, aggregate confidence intervals, valid-trial rate, and sample sizes, and SHALL suppress metrics that are mathematically ineligible.

#### Scenario: Too few attempts for pass at k
- **WHEN** a task has fewer than k valid attempts
- **THEN** pass@k and pass^k SHALL be null and the report SHALL explain the eligibility requirement

### Requirement: Secrets and task Oracles are isolated from agents
The system SHALL pass credentials ephemerally, remove them after execution, scan artifacts for leakage, and prevent evaluated agents from reading grader code, expected outputs, hidden assets, or other trials.

#### Scenario: Isolation violation invalidates a trial
- **WHEN** an agent-visible workspace contains Oracle material or a credential appears in persisted artifacts
- **THEN** the affected trial SHALL be invalid and the security release gate SHALL fail

