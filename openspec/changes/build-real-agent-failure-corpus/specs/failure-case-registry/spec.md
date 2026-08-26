## ADDED Requirements

### Requirement: Governed failure-case contract
The system SHALL represent every discovered failure as a versioned case with a stable ID, title, corpus stratum, affected surface, construct, observed failure, expected behavior, source provenance, evidence manifest, privacy classification, license or consent basis, contamination status, and reproduction status. The corpus stratum MUST distinguish Agent behavior, Agent Harness behavior, and ordinary product defects so the latter cannot inflate Agent-failure coverage.

#### Scenario: Register a public Agent failure
- **WHEN** an author registers a failure backed by an authoritative public Issue, PR, Commit, release note, or retained evaluation Trace
- **THEN** the system records immutable provenance and classifies the affected Agent or Harness surface before the case can be counted

#### Scenario: Ordinary bug is not counted as Agent failure
- **WHEN** a candidate describes a product defect without evidence that an Agent or Agent Harness triggered or exposed it
- **THEN** the system classifies or rejects it outside the scored Agent-failure stratum and excludes it from accepted Agent-failure counts

### Requirement: Primary evidence and integrity
The system MUST require at least one authoritative primary evidence item for an accepted case. Each evidence item SHALL record its evidence type, canonical locator, retrieval time, immutable revision when available, content digest or API object identity, availability class, and a concise claim that the evidence supports.

#### Scenario: Mutable Issue evidence is pinned
- **WHEN** a GitHub Issue or PR is used as source evidence
- **THEN** the registry records repository identity, object number, object state, authoritative API or page locator, retrieval time, and the relevant fixing or reproducing revision when one exists

#### Scenario: Evidence cannot be verified
- **WHEN** evidence is missing, inaccessible, mutable without a retained identity, or does not support the claimed failure
- **THEN** the case remains discovered or rejected with an explicit blocker and cannot enter the accepted count

### Requirement: Evidence-derived lifecycle
The system SHALL derive case state from artifacts and approvals rather than trusting an author-supplied status. Supported states MUST include discovered, triaged, reproduced, minimized, task-ready, calibrated, reviewed, piloted, release-eligible, and rejected.

#### Scenario: Reproduction evidence promotes a case
- **WHEN** triage is complete and an isolated reproduction matches the registered observed failure at a pinned target revision
- **THEN** the derived state advances to reproduced and records the reproduction evidence digest

#### Scenario: Missing review blocks release
- **WHEN** a case has reproduction, task, and calibration evidence but lacks required independent reviews
- **THEN** its derived state does not advance beyond calibrated and lists the missing review roles

### Requirement: Root-cause deduplication
The system MUST detect exact evidence duplicates and SHALL group semantically related candidates under a stable root-cause family. Multiple reports of the same underlying failure MUST count once for corpus coverage unless they exercise materially different environments or failure mechanisms documented by evidence.

#### Scenario: Duplicate issue reports
- **WHEN** two candidates reference the same upstream fix or reproduce the same root cause under equivalent conditions
- **THEN** the audit groups them, identifies a canonical case, and excludes aliases from the accepted-case total

### Requirement: Privacy, security, and use authorization
The system MUST fail closed on suspected credentials, private keys, personal data without an approved handling basis, unlicensed copied fixtures, or private evidence placed in the public repository. Private evidence SHALL be represented only by a sanitized manifest and an externally retained digest.

#### Scenario: Candidate contains an API key
- **WHEN** registry content or committed evidence matches a secret detector
- **THEN** the technical gate fails and reports the affected file without reproducing the secret value

#### Scenario: Authorized private incident
- **WHEN** an authorized private incident is registered
- **THEN** the public case records consent, retention, redaction, access class, and an external evidence digest without storing raw private content

### Requirement: Corpus coverage and claim boundaries
The system SHALL report discovered, accepted, rejected, reproduced, task-ready, and release-eligible counts separately by stratum, category, construct, source project, and root-cause family. A configured target of 20–50 cases MUST NOT be reported as achieved from discovered or duplicate candidates.

#### Scenario: Initial five-case pilot
- **WHEN** five cases have authoritative evidence but only three reproduce successfully
- **THEN** the report states five evidence-backed candidates and three reproduced cases rather than five completed benchmark tasks

### Requirement: Auditable registry command
The CLI SHALL provide a deterministic registry audit command that emits machine-readable JSON and a concise Markdown report, returns a non-zero status on technical violations, and never performs network mutation.

#### Scenario: Clean registry audit
- **WHEN** all case contracts, paths, digests, evidence identities, and privacy checks pass
- **THEN** the command writes canonical reports with a stable corpus digest and exits successfully

#### Scenario: Contract drift
- **WHEN** a registered evidence manifest, reproduction artifact, or task mapping changes without the corresponding version and digest update
- **THEN** the command fails with a precise drift blocker
