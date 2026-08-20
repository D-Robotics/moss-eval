## ADDED Requirements

### Requirement: GitHub source resolution
The system SHALL accept a canonical public GitHub repository URL, validate its host and repository identity, resolve the requested branch, tag, or default branch to a full commit SHA, and evaluate only a snapshot pinned to that SHA.

#### Scenario: Resolve a public repository
- **WHEN** a user submits a valid public GitHub repository URL without a ref
- **THEN** the system resolves the default branch to a full commit SHA and creates a source record containing the canonical URL and resolved SHA

#### Scenario: Reject an unsupported source URL
- **WHEN** a user submits a malformed URL or a URL whose provider is not supported
- **THEN** the system rejects it before clone or execution and explains the accepted source formats

### Requirement: Immutable local source snapshot
The system SHALL copy an accepted local source directory into an evaluator-managed immutable snapshot and SHALL NOT build, modify, or execute files from the original directory.

#### Scenario: Ingest a local directory
- **WHEN** a user selects a readable local source directory
- **THEN** the system creates a managed snapshot, computes its content fingerprint, and uses only that snapshot in later stages

#### Scenario: Original source changes after ingestion
- **WHEN** files in the original local directory change after the snapshot is created
- **THEN** the prepared target and evaluation continue to reference the original snapshot fingerprint until the user explicitly refreshes the source

### Requirement: Source provenance and exclusions
The system SHALL record source type, canonical location, resolved revision when applicable, snapshot fingerprint, creation time, relevant dirty-state metadata, and applied exclusion rules in every prepared target and run report. The snapshotter MUST exclude evaluator output, version-control internals, dependency caches, and configured secret patterns from copied content.

#### Scenario: Record Git provenance
- **WHEN** a GitHub source is prepared and evaluated
- **THEN** the report identifies its canonical repository URL, full commit SHA, snapshot fingerprint, and exclusion policy version

#### Scenario: Local Git worktree contains uncommitted files
- **WHEN** a local Git worktree with tracked or untracked changes is ingested
- **THEN** the report distinguishes the repository revision from the actual snapshot fingerprint and records that the snapshot was dirty without modifying the worktree

### Requirement: Source size and filesystem safety
The system SHALL enforce configurable limits on source file count, total bytes, individual file size, symbolic-link traversal, path length, and traversal outside the selected root before accepting a snapshot.

#### Scenario: Symbolic link escapes selected root
- **WHEN** a selected local source contains a symbolic link or junction resolving outside the selected root
- **THEN** the system excludes or rejects that entry, reports the reason, and does not read the external target into the snapshot

#### Scenario: Source exceeds configured limit
- **WHEN** source ingestion would exceed a configured safety limit
- **THEN** ingestion stops with a structured limit error and no target preparation begins
