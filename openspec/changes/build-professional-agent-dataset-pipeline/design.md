## Context

The repository currently loads `*.task.json` files directly, copies a fixture into each trial, runs the Agent and graders through the same runner abstraction, and calibrates every task with one generated reference plus three generic malformed-result controls. This produces reproducible integration evidence, but it does not establish construct validity, task-specific Oracle quality, reviewer independence, contamination resistance, or professional release eligibility. The Docker runner also mounts task and evaluator directories during the Agent phase, so a determined Agent could inspect grader assets.

The new system must remain useful in an open-source repository while acknowledging that a scored hidden benchmark cannot publish its holdout Oracles. It must support Windows development, Docker-isolated Agent execution, offline deterministic calibration, and credential-free CI. Manual evidence such as domain review and real multi-Agent pilot results cannot be synthesized by automation and must therefore fail closed when absent.

## Goals / Non-Goals

**Goals:**

- Define a testable professional dataset contract with explicit track, provenance, privacy, review, alternate-solution, negative-control, contamination, pilot and release evidence.
- Execute every declared positive and negative control, not just generic controls.
- Prevent Agent-phase access to task directories, evaluator source and Oracle bundles for professional tasks.
- Produce deterministic audit, calibration and release reports with content-addressed manifests.
- Seed the workflow with independently isolated development tasks that prove the machinery without being misrepresented as a professional scored release.
- Validate a pinned, clean official MOSS source snapshot only after technical dataset gates pass and label any run according to the dataset evidence actually available.

**Non-Goals:**

- Fabricating human review, consent, private production traces, hidden holdouts or cross-Agent pilot evidence.
- Declaring the existing 50-task core pack professional or migrating it automatically.
- Publishing model credentials, raw sensitive traces, proprietary customer data or evaluator-only Oracle content.
- Producing a public MOSS leaderboard score from a development seed pack.
- Modifying the MOSS repository or overwriting an existing dirty checkout.

## Decisions

### 1. Separate legacy task packs from professional datasets

Professional assets live under `datasets/` and use a task-card schema. Existing `taskpacks/core` remains an integration/candidate pack. Promotion is explicit and creates a release manifest; folder placement or a `quality_tier` string alone never establishes release status.

Alternative considered: extend `core.task.json` in place. Rejected because defaults hide missing evidence, shared fixtures encourage accidental coupling, and legacy compatibility would make fail-closed validation difficult.

### 2. Use four evaluation tracks

The contract distinguishes `adapter-conformance`, `general-capability`, `target-regression`, and `private-business`. Adapter conformance is excluded from capability scores. Target regression is reported separately from target-neutral capability results. Private-business assets are never required in the public repository.

Alternative considered: a single weighted score. Rejected because protocol failures, target-specific regressions and general capability are different constructs.

### 3. Make release state evidence-derived

The pipeline derives `candidate`, `calibrated`, `reviewed`, `pilot`, or `release-eligible` from evidence. Authors cannot self-assert a higher state. Missing evidence yields `not-established` with blocking reasons.

Alternative considered: trust a manually written `quality_tier`. Rejected because it is unauditable and can drift from artifacts.

### 4. Isolate Oracle assets by execution phase

Professional tasks set `oracle_isolation: evaluator-only`. During the Agent phase the Docker runner mounts only the workspace and trial-secret surface required by the adapter; task and evaluator roots are absent. Graders run in a fresh process/container after Agent termination with read-only Oracle access. Run artifacts record the mount policy and an Oracle bundle digest, not Oracle content.

Development seed Oracles may be committed for pipeline tests but are marked `public-development`; they can never satisfy a scored hidden-release gate. A professional scored release requires an external hidden Oracle bundle supplied at execution time and verified against the release digest.

Alternative considered: read-only Oracle mounts during Agent execution. Rejected because read-only prevents mutation, not answer discovery.

### 5. Represent controls as complete, executable cases

Each task card declares at least two positive controls covering materially different valid approaches and at least three task-specific negative controls. A control is an overlay plus an expected decision. Calibration copies the pristine fixture, applies the overlay, invokes the real Oracle and compares the actual decision with the declared expectation. Generic receipt and boundary controls remain supplemental.

Alternative considered: store control names as metadata. Rejected because the current implementation demonstrates that declared controls can exist without ever running.

### 6. Content-address all release inputs

Canonical hashing covers normalized task cards, public prompts, fixtures, control inputs, Oracle bundle digest, reviews, contamination evidence and pilot summaries. Release manifests contain no secrets and are immutable for a version. Any content change requires a new dataset version.

### 7. Treat statistical evidence as a gate, not decoration

Pilot summaries must declare agent families, model/config fingerprints, attempts and per-task outcomes. Release eligibility requires configurable minimum agent families and observations, valid-trial coverage, non-degenerate difficulty and positive discrimination. Reliability uses repeated attempts and reports both `pass@k` and `pass^k`. Small samples remain `not-established` rather than receiving unstable rankings.

### 8. Pin official target identity independently of local checkouts

Official MOSS validation resolves `refs/heads/main` from `git@github.com:D-Robotics/moss.git`, records the commit, creates a separate clean snapshot, verifies `git status --porcelain` is empty, and builds an image whose digest is recorded. Existing local branches and dirty worktrees are never modified or called official.

### 9. Keep primary and diagnostic metrics separate

Primary results are outcome, safety, validity and reliability. Cost, latency and tool efficiency are conditional on successful valid trials. Tool Precision/Recall/F1 is emitted only where the task has an independently reviewed tool-policy invariant; it is otherwise diagnostic and excluded from release gates.

## Risks / Trade-offs

- [Human review and private evidence are unavailable in CI] → CI validates schemas and development controls but the release command fails closed until signed review and pilot artifacts are supplied.
- [Hidden Oracle operation complicates local development] → provide public development Oracles and digest-compatible external bundle resolution; label all public-seed runs non-scored.
- [Task-specific fixtures increase repository size] → keep fixtures minimal, ban dependency/vendor directories, and use content hashes to detect accidental duplication.
- [Source-derived tasks may leak personal or proprietary data] → require consent/license/redaction fields, secret scanning and explicit privacy approval before calibration or release.
- [Equivalent solutions can still be missed] → require multiple positive controls, property/behavior checks where possible, and reviewer sign-off on alternate paths.
- [Pilot statistics can be gamed by repeated variants of one model] → count distinct declared agent families and configuration fingerprints, and retain task-level raw outcome summaries.
- [A clean remote snapshot may differ from a user's local MOSS branch] → report official and local-track identities separately; never merge their scores.
- [Real-model validation consumes money] → run one Canary after all deterministic gates; broader runs require an eligible suite and explicit configured credentials.

## Migration Plan

1. Add dataset contracts, audit/calibration/release commands and tests without changing legacy pack behavior.
2. Add development seed tasks with unique fixtures and executable task-specific controls.
3. Add evaluator-only mount behavior behind an explicit professional-task flag and verify legacy Docker behavior separately.
4. Add CI technical gates for the seed dataset; do not add a scored release artifact.
5. Run deterministic audit and calibration, then create a clean pinned MOSS snapshot and run a single development Canary.
6. Accept real independently reviewed tasks and external hidden Oracle/pilot evidence in later dataset versions; only then generate a professional release manifest and broader MOSS score.
7. Rollback removes the new dataset commands and professional assets; legacy task packs and prior run artifacts remain readable.

## Open Questions

- Which organization role will act as the independent domain reviewer and which role will own evaluation-method review?
- Where will hidden Oracle bundles and private-business fixtures be stored and access-controlled outside the public repository?
- Which two or more non-MOSS Agent families may be used for discrimination pilots without violating license or service terms?
