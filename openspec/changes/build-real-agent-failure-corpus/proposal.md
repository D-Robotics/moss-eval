## Why

The current professional seed proves that deterministic task production and calibration work, but it contains only three synthetic tasks and cannot support credible claims about real-world Agent reliability. We need an evidence-backed corpus of reproducible failures so task design starts from observed Agent and Harness breakdowns rather than invented prompts.

## What Changes

- Add a governed failure-case registry that records public or authorized evidence, provenance, licensing, privacy, contamination, affected Agent/Harness surface, and evidence integrity.
- Add an evidence-derived lifecycle from discovered candidate through triage, reproduction, minimization, task production, calibration, review, pilot, and release eligibility.
- Add deterministic ingestion, audit, deduplication, secret scanning, and coverage reporting for a target corpus of 20–50 accepted cases.
- Add a reproducibility contract requiring a pinned target revision, isolated environment, trigger, observed failure, expected behavior, and retained reproduction evidence before a case can become a scored task.
- Add production support for converting accepted cases into `target-regression` or `general-capability` tasks without exposing private evidence or hidden Oracles to the Agent.
- Produce and verify an initial batch of five evidence-backed pilot cases before scaling the registry to 20–50 cases.
- Keep synthetic seeds, ordinary product bugs, unverified issue summaries, duplicate root causes, and non-Agent failures out of the accepted real-failure count.

## Capabilities

### New Capabilities

- `failure-case-registry`: Governed discovery, provenance, privacy, evidence integrity, triage, deduplication, lifecycle state, and coverage reporting for real Agent failure cases.
- `failure-case-production`: Reproduction, minimization, deterministic Oracle authoring, positive/negative control calibration, isolation, and promotion of accepted failures into evaluation tasks.

### Modified Capabilities

None.

## Impact

- Adds dataset contracts, CLI commands, reports, tests, and documentation under `src/dataset`, `bin`, `datasets`, and `.moss-eval/datasets`.
- Adds an OpenSpec-governed pilot registry and evidence manifests; raw private evidence and credentials remain outside the repository.
- Uses existing process isolation, canonical digest, task validation, professional calibration, and release-gate components.
- Public-source collection may access GitHub and other authoritative upstream repositories, but ingestion remains read-only and records immutable source URLs and revisions.
