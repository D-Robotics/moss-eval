## ADDED Requirements

### Requirement: Static Harness inspection
The system SHALL inspect source snapshots without executing repository code and SHALL return evidence-backed Harness candidates, confidence, detected entry points, manifest presence, runtime hints, and warnings.

#### Scenario: Detect MOSS from source evidence
- **WHEN** a source snapshot contains the signatures required by the built-in MOSS detector
- **THEN** inspection proposes the MOSS adapter and lists the files and declarations that caused the match

#### Scenario: Inspection is inconclusive
- **WHEN** static evidence is insufficient or conflicting
- **THEN** the system marks detection as inconclusive and requires explicit user configuration before preparation

### Requirement: Versioned Harness manifest
The system SHALL support a versioned `.moss-eval/harness.json` file whose schema declares adapter identity, preparation instructions, launch contract, supported interaction modes, telemetry capabilities, required environment inputs, and task capability tags.

#### Scenario: Load a valid manifest
- **WHEN** inspection finds a manifest conforming to a supported schema version
- **THEN** the system displays its effective configuration and validation result before the user prepares the target

#### Scenario: Reject an unsafe or invalid manifest
- **WHEN** a manifest is malformed, uses an unsupported schema version, references paths outside the snapshot, or requests prohibited privileges
- **THEN** the system rejects preparation with field-level errors and does not execute manifest instructions

### Requirement: Guided configuration for unknown Harnesses
The system SHALL provide a guided flow for configuring an unknown Harness and SHALL require the user to review its runtime, build, launch, protocol, telemetry, environment, network, and secret requirements before saving a local target profile.

#### Scenario: Configure an unknown Harness
- **WHEN** automatic discovery has no supported adapter and the user completes all required configuration fields
- **THEN** the system validates the configuration in the sandbox and stores a source-fingerprint-bound target profile only after explicit confirmation

#### Scenario: Source changes after guided configuration
- **WHEN** a saved target profile is opened against a different source fingerprint
- **THEN** the system marks the profile stale and requires revalidation before use

### Requirement: Adapter registry contract
The system SHALL use a versioned adapter registry in which each adapter exposes identity, compatibility, inspection, preparation, launch, telemetry collection, capability description, and fingerprint behavior through a common contract.

#### Scenario: Select a compatible adapter
- **WHEN** a manifest or confirmed detector result names a registered compatible adapter
- **THEN** the system records the adapter identifier and version and delegates preparation and launch through the common contract

#### Scenario: Adapter is unavailable or incompatible
- **WHEN** a target requests an uninstalled adapter or an incompatible adapter API version
- **THEN** the system prevents evaluation and reports the exact missing or incompatible adapter requirement
