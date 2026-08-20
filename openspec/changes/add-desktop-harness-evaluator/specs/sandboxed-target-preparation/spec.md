## ADDED Requirements

### Requirement: Isolated preparation and execution
The system SHALL perform all source-controlled build steps and Harness execution inside an isolated Docker-compatible sandbox reached through the supported Windows runtime, and SHALL NOT execute repository-provided commands directly on the host.

#### Scenario: Build a prepared target
- **WHEN** the user confirms a valid inspected target
- **THEN** all repository-controlled build instructions run inside the sandbox against the managed snapshot

#### Scenario: Sandbox is unavailable
- **WHEN** no supported sandbox runtime is healthy
- **THEN** preparation is blocked with diagnostic remediation and no repository command runs on the host

### Requirement: Least-privilege sandbox policy
The system SHALL deny host Docker control sockets, privileged mode, host process namespaces, unrestricted host filesystem mounts, and outbound network access by default, and SHALL apply CPU, memory, process, disk, and time limits to preparation and trials.

#### Scenario: Target requests a prohibited privilege
- **WHEN** an adapter or manifest requests privileged mode, Docker socket access, or an unrestricted host mount
- **THEN** the request is rejected as unsupported and cannot be approved through the normal user flow

#### Scenario: Trial exceeds a resource budget
- **WHEN** a preparation or trial exceeds its configured time or resource limit
- **THEN** the system terminates that sandbox, records `budget_exceeded` with the breached limit, and preserves available diagnostics

### Requirement: Explicit network and secret authorization
The system SHALL present the exact network policy and named secret inputs before granting them to a build or trial, SHALL separate clone credentials from target runtime credentials, and SHALL redact secret values from logs, traces, artifacts, and UI events.

#### Scenario: Dependency installation requires network
- **WHEN** preparation declares outbound dependency access and the user grants the scoped request
- **THEN** the sandbox receives only the approved network policy for that preparation and the approval is recorded without secret values

#### Scenario: User denies requested access
- **WHEN** the user denies network or a required secret request
- **THEN** preparation stops with a structured authorization outcome and does not silently broaden access

### Requirement: Reproducible prepared target
The system SHALL emit a prepared-target manifest containing the source fingerprint, adapter identity and version, effective configuration hash, build inputs, sandbox policy, runtime versions, image digest, and supported capabilities. Evaluation SHALL use the immutable image digest rather than a mutable tag.

#### Scenario: Reuse an unchanged prepared target
- **WHEN** source fingerprint, adapter fingerprint, effective configuration, and preparation policy are unchanged
- **THEN** the system may reuse a verified cached target with the same prepared-target fingerprint

#### Scenario: Preparation input changes
- **WHEN** any fingerprinted source, adapter, configuration, dependency, or policy input changes
- **THEN** the system creates a different target fingerprint and does not misattribute results to the prior target

### Requirement: Preparation cancellation and cleanup
The system SHALL support cooperative cancellation and bounded forced termination for preparation, remove transient containers and sensitive temporary material, and retain only declared diagnostic artifacts.

#### Scenario: Cancel an active preparation
- **WHEN** the user cancels preparation
- **THEN** the system stops the active sandbox within a bounded interval, marks preparation cancelled, and leaves the source snapshot and original source intact
