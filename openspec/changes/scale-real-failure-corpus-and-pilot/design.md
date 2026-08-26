## Context

The repository already has a governed five-case real-failure corpus, a generated pilot taskpack, deterministic calibration controls, MOSS source-track execution, telemetry validation, and desktop/CLI result views. That path is sufficient for development smoke testing, but not for a defensible benchmark: coverage is small, all development Oracles are public, independent agent adapters have not been qualified under one frozen protocol, and the system has no non-forgeable distinction between machine checks and human approval.

The principal stakeholders are dataset maintainers, agent-adapter maintainers, independent reviewers, release owners, and users interpreting results. The design must work locally on Windows with Docker/WSL while remaining CI-verifiable without requiring model credentials or private evaluation assets.

## Goals / Non-Goals

**Goals:**

- Establish at least 20 accepted, source-pinned real failure mechanisms with reproducible evidence and quantitative coverage limits.
- Generate one deterministic task and task-specific control suite per accepted mechanism.
- Compare MOSS with two independent agent families only after adapter qualification and under an immutable protocol manifest.
- Create reviewer-ready packets and authenticated sign-off records without allowing automation to impersonate reviewers.
- Support local-only hidden Oracles and make release eligibility fail closed when they, human reviews, or required run evidence are missing.
- Present result meaning, uncertainty, comparability, and blockers in user-facing reports.

**Non-Goals:**

- Claim that 20 cases represent all production Agent failures or establish a universal leaderboard.
- Scrape private incidents or infer user failures without provenance and consent.
- Commit hidden Oracle contents, API keys, or reviewer credentials to the public repository.
- Make deterministic tasks artificially identical across agent interfaces; adapters may translate protocol envelopes but may not change task semantics or budgets.
- Replace independent human judgment with LLM-as-Judge.

## Decisions

### 1. Use a data-driven failure catalog and immutable generated taskpack

Each accepted case will have a catalog record plus evidence files containing source URL, base/fix revisions, affected paths, reproduction receipt, minimization decision, taxonomy, and task mapping. A generator will create the runnable taskpack and controls from that catalog. Dataset and protocol digests will be carried into every run.

Alternative considered: continue hard-coding cases in one generator module. Rejected because it makes reviews, incremental additions, and lineage diffs unnecessarily coupled to executable code.

### 2. Count mechanisms, not pull requests

One source change may provide multiple cases only when each has a distinct trigger, failure effect, fix evidence, minimized fixture, and Oracle. Closely related symptoms with one root cause remain one case. Coverage reports will include source, taxonomy, component, severity, and temporal concentration, and will block release when concentration limits are violated.

Alternative considered: one PR equals one case. Rejected because it both double-counts batch fixes and under-counts independently reproducible defects within a batch.

### 3. Separate three trust planes

Public development Oracles live in the repository and support contributor feedback. Hidden release Oracles live in a user-provided, gitignored directory and are referenced only by a salted manifest of identifiers/digests. Human sign-offs are detached records containing reviewer identity, role, reviewed artifact digest, decision, timestamp, and signature/HMAC verification metadata. Each plane has a distinct gate.

Alternative considered: obfuscate hidden tests in the repository. Rejected because obfuscation is not confidentiality and evaluated agents could recover the Oracle.

### 4. Freeze a cross-agent protocol before scoring

The protocol manifest pins dataset digest, task order, attempts, timeout, concurrency, model/provider declaration, network policy, hardware class, and adapter version. Every adapter first runs qualification tasks for prompt delivery, workspace mutation, process exit handling, trace capture, and secret cleanup. Unqualified runs are reported as infrastructure-invalid, not scored failures.

Alternative considered: run every available CLI immediately and compare pass rates. Rejected because interface incompatibilities and missing authentication would contaminate the capability comparison.

### 5. Produce review packets, never synthetic approvals

Automation will generate stable Markdown/JSON packets with exact evidence commands, hashes, diffs, controls, and reviewer checklists. It will validate supplied signatures and role separation but never create a human approval. Two-person separation is required for release: dataset/Oracle reviewer and release owner must be distinct identities.

Alternative considered: permit a local developer flag to bypass review. Rejected for formal releases; an explicit development-only report remains available and visibly marked ineligible.

### 6. Treat release eligibility as a machine-readable claim

A release evaluator will emit `eligible`, gate-by-gate evidence, and blocking reasons. Required gates include corpus size/coverage, source reproduction, calibration, adapter qualification, cross-agent completion, hidden-Oracle execution, human sign-offs, telemetry validity, secret scan, regression thresholds, and packaged-client smoke testing. CLI and desktop consume the same artifact rather than recomputing policy independently.

Alternative considered: document a manual checklist only. Rejected because manual status drifts and cannot reliably prevent misleading exports.

## Risks / Trade-offs

- [Public source history may not reproduce on current toolchains] → Pin containers and source revisions; record an explicit environment-invalid outcome rather than rewriting history.
- [Twenty cases may still be concentrated in one repository or component] → Enforce and display coverage thresholds; label the result a MOSS-focused pilot rather than a universal benchmark.
- [Hidden assets make public CI unable to prove the full release] → CI proves schema and fail-closed behavior with synthetic fixtures; a trusted release environment attaches the private gate receipt.
- [Cross-agent costs and stochasticity are high] → Use a small frozen pilot, repeated trials, confidence intervals, cost budgets, and resumable runs.
- [Review signatures can become stale after regeneration] → Bind every signature to corpus, taskpack, protocol, and review-packet digests; invalidate on any digest change.
- [Desktop detail can overwhelm users] → Lead with plain-language status and blockers, with technical metrics and evidence available progressively.

## Migration Plan

1. Introduce catalog schemas, migrate the existing five cases without changing their task semantics, and prove digest-aware calibration.
2. Add and review cases in batches until all size and coverage gates pass.
3. Add adapter qualification and protocol manifests; run MOSS first, then independent agents.
4. Add private-bundle contracts, review packets, sign-off validation, and release evaluation in fail-closed mode.
5. Wire the shared release artifact into CLI/desktop and add packaged-client tests.
6. Keep existing development commands as aliases during migration. Rollback consists of disabling new release commands while retaining generated evidence; no existing run artifacts are deleted.

## Open Questions

- Which two independent agent/model families will be authorized and funded for the formal comparison?
- Who will serve as dataset/Oracle reviewer and release owner, and what signing mechanism will the organization require?
- What trusted storage and execution environment will hold hidden release Oracles in CI or release operations?

