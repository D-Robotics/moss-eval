## Why

The current core pack is useful for harness integration and regression, but it cannot support a defensible Agent performance claim: only a subset of tasks has task-specific semantic Oracles, most controls are generic, fixtures are heavily shared, and no release gate measures leakage, reviewer independence, alternate-solution acceptance, task-specific negative rejection, or statistical discrimination. A professional dataset and a reproducible production pipeline are required before MOSS or any comparable harness is scored publicly or used for release decisions.

## What Changes

- Define a versioned Dataset Spec that separates adapter conformance, general Agent capability, MOSS-specific regression, and private business evaluation tracks.
- Introduce a machine-readable task card with source provenance, consent and redaction status, construct tags, independent reviewers, fixture digest, hidden-Oracle ownership, valid alternate solutions, task-specific negative controls, contamination status, pilot evidence, and release state.
- Build a task production pipeline that ingests candidate cases, validates and normalizes task cards, materializes isolated fixtures, runs reference and negative controls, calculates quality evidence, and promotes only eligible tasks into a frozen release manifest.
- Move professional release grading to evaluator-owned Oracle bundles that are not mounted into the Agent workspace or Agent runtime container.
- Add deterministic dataset quality gates for schema validity, source traceability, secret scanning, fixture isolation, task-specific control execution, reviewer independence, duplicate and contamination checks, suite balance, and immutable release digests.
- Add pilot-analysis support for difficulty, discrimination, validity, reliability, outcome/safety/efficiency separation, and explicit minimum sample requirements; insufficient evidence produces `not-established`, never an optimistic score.
- Create a small professionally authored seed pack to prove the pipeline end to end. Existing 50 core tasks remain integration/candidate material and are not silently promoted.
- Verify an independently pinned clean snapshot of the official D-Robotics MOSS repository only after all dataset and execution gates pass, beginning with a low-cost Canary before any broader run.

## Capabilities

### New Capabilities

- `professional-dataset-contract`: Versioned task-card, track, provenance, Oracle, control, review, privacy, contamination, and release-state requirements.
- `task-production-pipeline`: Deterministic candidate ingestion, fixture materialization, Oracle isolation, control execution, review evidence, and promotion workflow.
- `dataset-quality-gates`: Fail-closed automated gates and auditable reports for validity, leakage, secrets, diversity, reproducibility, and statistical evidence.
- `benchmark-release-validation`: Immutable dataset releases and compliant target validation with pinned source identity, Canary sequencing, separated metrics, and evidence-bound claims.

### Modified Capabilities

None.

## Impact

- Adds a professional task-pack namespace, dataset schemas, authoring manifests, evaluator-only Oracle bundles, quality reports, release manifests, and CLI/script entry points.
- Extends task loading and validation without changing the execution semantics of legacy packs.
- Adds CI gates and tests; professional releases fail closed when manual review or pilot evidence is missing.
- Adds source-snapshot identity and clean-target requirements to official MOSS validation.
- Does not modify the MOSS source repository, publish private traces, store model credentials, or represent the existing core pack as a professional benchmark.
