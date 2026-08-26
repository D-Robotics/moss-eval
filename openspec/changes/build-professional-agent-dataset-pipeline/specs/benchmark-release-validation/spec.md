## ADDED Requirements

### Requirement: Dataset releases are immutable and content addressed
A professional dataset release SHALL have a unique semantic version and manifest digest covering normalized task cards, fixtures, controls, review evidence, contamination evidence, pilot summary and hidden Oracle bundle digest. Changed content MUST require a new release version.

#### Scenario: Release input changes
- **WHEN** any covered byte changes after a manifest is created
- **THEN** verification rejects the manifest and requires a new version

### Requirement: Target source identity is pinned and clean
Official target validation SHALL resolve the authoritative remote, pin an exact commit, prepare a separate clean snapshot, record remote URL, ref, commit, dirty status and image digest, and MUST NOT reuse or modify a dirty local checkout as the official baseline.

#### Scenario: Local MOSS checkout is dirty
- **WHEN** official MOSS validation is requested and the existing local checkout contains changes
- **THEN** the system leaves it untouched and prepares an independent pinned snapshot

#### Scenario: Remote identity differs
- **WHEN** the supplied repository remote is not the approved D-Robotics MOSS remote
- **THEN** the run is labeled non-official or blocked according to policy

### Requirement: Validation is gated and staged
Real-model target validation SHALL run only after dataset technical gates and environment readiness pass. It SHALL execute one Canary first, inspect validity, receipt, telemetry, secret cleanup and Oracle isolation, and SHALL start a broader suite only when the Canary passes the configured eligibility criteria.

#### Scenario: Canary is invalid
- **WHEN** the Canary has provider, runtime, receipt, telemetry, secret or isolation failure
- **THEN** the broader run is not started and the report identifies configuration rather than Agent capability failure

### Requirement: Claims match available evidence
Reports SHALL distinguish run validity, outcome, safety, reliability, efficiency and release eligibility. A development or non-comparative dataset MUST NOT produce a professional leaderboard claim, and post-hoc Oracle fixes MUST be reported separately from canonical stored results.

#### Scenario: Development seed evaluates MOSS
- **WHEN** MOSS runs successfully on public development tasks
- **THEN** the report describes integration and pilot outcomes while professional benchmark validity remains `not-established`

### Requirement: Credentials and sensitive artifacts are controlled
Model credentials SHALL be provided through approved runtime secret channels, excluded from task cards, manifests, command summaries and Git, redacted from traces, and deleted from temporary storage after every trial. Validation SHALL scan persisted artifacts for credential patterns without printing matched values.

#### Scenario: Credential pattern persists
- **WHEN** post-run scanning detects a possible credential in persisted artifacts
- **THEN** the run is non-compliant, broader execution stops and the report names only affected artifact paths

### Requirement: Metrics are conditionally comparable
Outcome and safety SHALL be primary metrics. Cost, latency and tool efficiency SHALL be compared only among valid successful trials with coverage reported. Tool F1 SHALL be excluded when no independently reviewed tool-policy invariant exists.

#### Scenario: Task succeeds over budget
- **WHEN** the final outcome passes but a budget is exceeded
- **THEN** reports show outcome success and constraint failure separately instead of converting the outcome into an unexplained failure
