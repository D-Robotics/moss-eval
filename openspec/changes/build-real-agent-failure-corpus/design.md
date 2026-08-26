## Context

`moss-eval` already has a professional synthetic seed, canonical digest helpers, deterministic Oracle calibration, source pinning, isolated Agent/grader phases, and release gates. What is missing is the upstream evidence layer: a governed way to discover real failures, prove that they occurred, reproduce them, separate Agent behavior from Harness/product defects, and trace promoted tasks back to authoritative incidents.

The first implementation must work with public GitHub evidence and locally retained evaluation artifacts while remaining safe for later authorized private incidents. It must not claim that a list of Issues is a benchmark, and it must not let candidate count substitute for reproduced or task-ready count.

## Goals / Non-Goals

**Goals:**

- Establish a strict case/evidence schema and evidence-derived lifecycle.
- Audit provenance, paths, content integrity, secrets, privacy, duplication, and coverage deterministically.
- Reproduce and minimize cases in isolated workspaces before task production.
- Reuse the existing professional task pipeline for Oracle calibration and release gating.
- Produce an initial five-case evidence-backed pilot and make every incomplete stage explicit.
- Scale the same registry to 20–50 accepted cases without weakening gates.

**Non-Goals:**

- Fabricating production incidents, reviewer approvals, private holdouts, or cross-Agent Pilot observations.
- Treating every upstream bug as an Agent failure.
- Scraping private systems or copying unlicensed repository content.
- Publishing a Professional score from the initial public pilot.
- Requiring a fixed tool sequence when final behavior can be scored deterministically.

## Decisions

### Store a manifest plus one directory per case

The corpus will live under `datasets/real-failures/` with `registry.json` and `cases/<case-id>/case.json`. Case directories may contain sanitized evidence manifests, reproduction definitions, receipts, minimization notes, and a mapping to a promoted task. Raw private evidence remains external and is referenced only by digest.

This is preferred over a single large JSON file because versioning, review, evidence changes, and case-specific artifacts remain independently auditable. A database was considered but rejected for the first implementation because it weakens Git reviewability and reproducibility.

### Separate strata before counting coverage

Every case declares `agent-behavior`, `agent-harness`, or `product-defect`. Only the first two feed the Agent/Harness evaluation corpus, and reports keep them separate. `product-defect` can remain as rejected or linked context but never increases the accepted Agent-failure number.

This prevents known desktop bugs from being relabeled as Agent intelligence failures while still allowing Harness regression tests to be built from them.

### Retain evidence identity, not arbitrary copied content

Public evidence records canonical repository/object identity, immutable Commit when available, retrieval time, supported claim, and a digest of the normalized evidence record. Small necessary excerpts may be paraphrased. Private evidence is never committed.

Directly mirroring Issue bodies was considered but rejected because content is mutable, may contain personal data, and creates licensing and deletion problems.

### Derive state and accepted counts

State is computed from evidence: contract validity, triage decision, reproduction receipt, minimization receipt, promoted task mapping, calibration report, reviews, Pilot, and hidden holdout. Author-entered status is not authoritative. Reports show candidate, reproduced, task-ready, and release-eligible counts separately.

### Use adapter-like reproduction drivers

Each reproduction definition declares a bounded local or Docker command, environment fingerprint, expected exit/signature assertions, and allowed network mode. The first implementation supports deterministic command reproduction; later integrations can add HTTP or device drivers without changing the case contract.

Reproduction commands execute only after explicit task-level authorization. Registry audit itself is read-only and never executes evidence instructions.

### Reuse professional task calibration after promotion

Promoted cases generate or reference the existing Task Card format. The failure corpus adds `source_case_id`, `source_evidence_digest`, track selection, and minimization rationale; it does not introduce a second competing grader framework.

### Start with five cases and preserve rejection evidence

The first batch will contain five authoritative candidates selected for distinct root causes. Cases that fail reproduction or turn out to be ordinary defects remain in `rejected-cases.json` with reason codes. This makes selection pressure visible and prevents silent cherry-picking.

## Risks / Trade-offs

- **Public sources may be contaminated or later edited** → Pin repository/object identity and fix Commit; label public cases development-only.
- **Issue descriptions may not reproduce** → Keep them as candidates and exclude them from reproduced counts.
- **Minimization can create artificial tasks** → Require a preservation receipt comparing original and minimized failure signatures.
- **Root-cause grouping requires judgment** → Record a deterministic family key plus reviewer rationale; never auto-merge solely from text similarity.
- **Five pilot cases may overrepresent MOSS** → Report coverage by source and construct and block general claims until cross-project coverage exists.
- **Private incidents create leakage risk** → Keep raw evidence outside Git, require explicit authorization metadata, and scan all committed content.
- **Reproduction commands are potentially hostile** → Default to Docker, bounded resources, no secrets, no host mounts beyond an isolated workspace, and explicit network authorization.

## Migration Plan

1. Add registry, case, evidence, reproduction, and receipt contracts without changing existing task packs.
2. Add audit/report CLI and tests; CI runs audit on the pilot registry.
3. Register five public or locally evidenced candidates and retain rejected candidates explicitly.
4. Reproduce eligible cases, then promote only successful cases into existing professional task production.
5. Expand in reviewed batches of five until 20 accepted reproduced cases are reached; consider 50 only after coverage and duplication review.
6. Existing synthetic tasks remain development seeds and are not reclassified as real failures.

Rollback consists of removing the new CLI entry points and corpus directory; existing evaluation, task packs, and professional seed remain compatible.

## Open Questions

- Which independent reviewers will own domain and evaluation approval records?
- Which additional Agent families and model configurations will participate in the cross-Agent Pilot?
- Where will the private evidence and hidden Oracle bundle be retained and access-controlled?
- Which public upstream projects beyond MOSS are approved as collection sources for the 20-case milestone?
