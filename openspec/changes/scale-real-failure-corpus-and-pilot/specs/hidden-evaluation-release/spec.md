## ADDED Requirements

### Requirement: Development and release Oracles are separate
The system SHALL support public development Oracles and a private release-Oracle bundle whose contents are outside version control and ordinary evaluation artifacts.

#### Scenario: Public repository contains no hidden Oracle
- **WHEN** repository and package audits inspect tracked and bundled files
- **THEN** no private Oracle source, expected output, secret, or reversible hidden fixture SHALL be present

### Requirement: Hidden bundle identity is verifiable without disclosure
The system SHALL identify a private bundle through a salted manifest of case identifiers, schema version, content digests, and signing metadata while excluding Oracle contents from public reports.

#### Scenario: Bundle content changes
- **WHEN** any hidden Oracle or fixture changes
- **THEN** its manifest digest SHALL change and all sign-offs and release receipts bound to the previous digest SHALL become invalid

### Requirement: Release policy fails closed
The system SHALL emit a machine-readable release decision and SHALL set `eligible` to false unless all required corpus, calibration, source, adapter, cross-agent, hidden-Oracle, human-review, telemetry, security, regression, and packaged-client gates pass.

#### Scenario: Hidden run or human approval is missing
- **WHEN** only public development runs exist or a required independent sign-off is absent
- **THEN** the decision SHALL remain ineligible and list the missing evidence without a bypass for formal release

### Requirement: Review roles are separated
The system SHALL require the dataset/Oracle reviewer and release owner to be distinct verified identities and SHALL bind their decisions to the complete release evidence digest.

#### Scenario: Same identity signs both roles
- **WHEN** one identity supplies both required approvals
- **THEN** role-separation validation SHALL fail and release eligibility SHALL remain false

### Requirement: User-facing reports explain result status
CLI and desktop reports SHALL show the evaluated agent and model, dataset and protocol identities, task and trial counts, plain-language metric definitions, uncertainty, telemetry validity, comparability status, and prioritized release blockers.

#### Scenario: Development-only result is opened
- **WHEN** a user views a result that has not passed release gates
- **THEN** the primary status SHALL state that it is a development result and SHALL explain what evidence is still required

### Requirement: Exported claims preserve provenance
Every exported report SHALL include source revision, dataset digest, protocol digest, adapter identity, environment identity, run artifact path or immutable reference, and release-decision digest.

#### Scenario: Required provenance is unavailable
- **WHEN** an export cannot resolve any required identity
- **THEN** the export SHALL be visibly marked incomplete and SHALL NOT describe the result as release-eligible

