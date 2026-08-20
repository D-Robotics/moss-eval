## ADDED Requirements

### Requirement: Installable Windows distributions
The project SHALL produce versioned Windows installer and portable artifacts from CI, containing the desktop application and required evaluator resources, with checksums and build provenance.

#### Scenario: Install under Program Files
- **WHEN** the installer deploys the application to a read-only Program Files location
- **THEN** source inspection, target preparation, evaluation, history, and export work without writing inside the installation directory

#### Scenario: Run the portable build
- **WHEN** a user launches the supported portable artifact on a compatible Windows host
- **THEN** it locates packaged evaluator resources without depending on the development repository path or globally installed MOSS command

### Requirement: Mutable data placement
The application SHALL resolve configuration, source snapshots, prepared targets, runs, caches, and logs beneath the platform user-data directory and SHALL expose those resolved locations to the user.

#### Scenario: First launch
- **WHEN** the installed client launches for the first time
- **THEN** it creates only required mutable directories beneath its user-data root and records their schema version

#### Scenario: User opens an artifact location
- **WHEN** the user requests the location of a run or log
- **THEN** the client opens or reveals the evaluator-managed path and does not expose an assumed development path

### Requirement: Runtime prerequisite diagnostics
The client SHALL run a non-mutating environment doctor for Windows version, architecture, available disk, WSL2, Docker-compatible runtime, virtualization health, and required runtime reachability, and SHALL provide actionable remediation for missing prerequisites.

#### Scenario: WSL2 is missing
- **WHEN** the doctor cannot find a supported WSL2 environment
- **THEN** evaluation controls are disabled while source inspection remains available and the UI presents the failed check and remediation steps

#### Scenario: Docker daemon is unreachable
- **WHEN** Docker-compatible tooling exists but its daemon cannot be reached
- **THEN** the doctor distinguishes that condition from an absent installation and offers a retry after remediation

### Requirement: Packaged process resolution
The application SHALL resolve packaged resources from the runtime resource directory and launch the dedicated evaluation worker through an Electron-supported packaged-process mechanism rather than assuming `process.execPath` is a standalone Node executable.

#### Scenario: Start worker in packaged mode
- **WHEN** an installed client starts an evaluation worker
- **THEN** the worker loads the packaged core entry point and reports a compatible core version before accepting work

#### Scenario: Core and client versions mismatch
- **WHEN** the packaged worker reports an incompatible API or artifact schema version
- **THEN** the client blocks evaluation and reports the packaging defect without attempting partial execution

### Requirement: Repository and release hygiene
The repository SHALL track source and lockfiles required to reproduce the application and SHALL exclude generated installers, unpacked distributions, dependencies, run data, caches, credentials, and local configuration from source control. CI MUST test a clean packaged artifact rather than only development mode.

#### Scenario: Build from a clean checkout
- **WHEN** CI installs locked dependencies and builds from a clean checkout
- **THEN** it produces the same application layout without relying on untracked local files

#### Scenario: Packaged smoke test
- **WHEN** CI launches or inspects the packaged artifact in its supported test environment
- **THEN** it verifies resource resolution, user-data placement, worker handshake, and canonical artifact reading
