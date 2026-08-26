## Why

The current five-case pilot proves the evaluation path works, but it is too small and too narrowly sampled to support a professional claim about MOSS or other agent harnesses. The project now needs a governed 20-case minimum corpus, evidence-backed cross-agent runs, and release gates that prevent public-oracle overfitting or unreviewed results from being presented as conclusive.

## What Changes

- Expand the accepted real-failure corpus from 5 to at least 20 independently identified, reproducible, minimized, source-pinned cases with explicit lineage and rejection records.
- Produce a runnable, deterministic task for every accepted case, including task-specific controls, Oracle isolation checks, and calibration receipts.
- Add a cross-agent pilot protocol that runs the same frozen dataset and budgets against MOSS and at least two independent agent families, while separating product compatibility failures from task failures.
- Add human-review packets and machine-verifiable sign-off records for case acceptance, Oracle validity, and release approval; automated tooling may prepare but never self-sign human decisions.
- Split development and hidden release Oracles, prove that hidden assets are not committed or exposed to evaluated agents, and block formal release claims when hidden evaluation or required reviews are absent.
- Surface dataset identity, coverage, uncertainty, comparability, telemetry validity, and release blockers in CLI and desktop result reports.

## Capabilities

### New Capabilities

- `real-failure-scale-gates`: Governs the 20-case corpus, source evidence, minimization, task production, calibration, review packets, and quantitative coverage gates.
- `cross-agent-pilot`: Defines fair adapter qualification and frozen-protocol comparison across MOSS and independent agent families.
- `hidden-evaluation-release`: Separates public development Oracles from private release Oracles and enforces evidence, review, security, and reporting gates before a result is release-eligible.

### Modified Capabilities

None. No main capability specs are currently present; this change introduces the release-grade requirements as new capabilities.

## Impact

- Affects dataset manifests and generators under `datasets/` and `scripts/`, core validation and aggregation under `src/`, CLI commands, desktop result presentation, tests, CI, and release documentation.
- Adds generated review/sign-off artifacts and a local-only hidden-Oracle bundle contract; secrets and hidden Oracle contents remain excluded from version control and ordinary run artifacts.
- Requires access to source revisions for reproduction, configured agent adapters for cross-agent runs, and independent human reviewers before formal release eligibility can become true.
