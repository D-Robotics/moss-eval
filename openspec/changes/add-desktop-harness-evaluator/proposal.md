## Why

`moss-eval` currently works as a repository-oriented CLI and its desktop prototype is coupled to MOSS-specific source preparation, development paths, and an outdated run-artifact layout. To make the evaluator usable by ordinary Windows users, it needs an installable client that can safely accept a GitHub URL or local source directory, identify the contained Agent Harness, prepare an immutable target, run only compatible evaluations, and present trustworthy live and historical results.

## What Changes

- Add source ingestion for public GitHub repositories and local directories, including immutable snapshots, Git commit pinning, source fingerprints, and provenance recorded in every report.
- Add static Harness discovery with three explicit support paths: built-in adapters for known Harnesses such as MOSS, a versioned `.moss-eval/harness.json` manifest, and a guided configuration flow for unknown Harnesses.
- Generalize MOSS-specific source preparation into a target subsystem with an adapter registry, capability declaration, reproducible sandbox builds, and prepared-target fingerprints.
- Run all untrusted build and evaluation activity in an isolated Docker/WSL environment with explicit approvals for network access and secrets, bounded resources, and no access to the original local source directory or Docker control socket.
- Add capability-aware task selection and telemetry levels so unsupported tasks are reported as `NOT_APPLICABLE`, failures are isolated per trial, and comparisons disclose coverage instead of treating missing capabilities as failures.
- Replace broad desktop IPC and development-only process launching with a schema-validated desktop orchestration API and a dedicated evaluation worker supporting inspection, preparation, start, progress, cancellation, history, comparison, and report export.
- Make the desktop client installable under read-only application directories while keeping configuration, snapshots, runs, caches, and logs under the user data directory; provide prerequisite diagnostics and Windows installer/portable distributions.
- Harden the initial task suite around deterministic semantic outcome checks and diagnostic transcript checks, with optional, calibrated LLM-as-Judge scoring only where deterministic grading is insufficient.
- Define security, privacy, provenance, reliability, and packaging acceptance gates for shipping the desktop client.

## Capabilities

### New Capabilities

- `harness-source-ingestion`: Resolve GitHub URLs and local directories into immutable, attributable source snapshots without modifying the user's original source.
- `harness-discovery-manifest`: Detect supported Harnesses statically, validate a standard Harness manifest, and guide users through explicit configuration when automatic detection is insufficient.
- `sandboxed-target-preparation`: Prepare reproducible runnable targets through registered adapters inside bounded sandboxes with explicit network and secret authorization.
- `capability-aware-evaluation`: Match task requirements to Harness and telemetry capabilities, isolate trials, calculate coverage-aware metrics, and preserve canonical evaluation artifacts.
- `desktop-evaluation-orchestration`: Provide the installed desktop workflow, narrow IPC/service boundary, live status, cancellation, history, comparison, and report export.
- `desktop-packaging-runtime`: Package and run the Windows client independently of a development checkout, store mutable data in the correct user location, and diagnose runtime prerequisites.
- `evaluation-quality-gates`: Establish trustworthy task, grader, telemetry, privacy, and release-quality requirements for the initial supported evaluation suite.

### Modified Capabilities

None. The repository has no existing main capability specifications; this change establishes the initial desktop-evaluation contract.

## Impact

- Affected areas include `app/`, CLI orchestration, source preparation, adapters, runners, task schemas, graders, metrics, artifact readers/writers, configuration, packaging, and CI.
- The existing CLI and JSON artifacts remain supported, but desktop and CLI execution must share the same core services and current artifact schemas.
- MOSS remains the first built-in Harness adapter; future Harnesses integrate through the same manifest and adapter contracts rather than adding product-specific desktop logic.
- The Windows MVP depends on WSL2 and Docker-compatible sandbox execution. Private repository authentication, broader language auto-detection, ACP/PTY support, and browser/device execution are staged after the public-GitHub/local-source MVP.
- Existing evaluation results remain readable through versioned artifact readers or explicit migration; reports produced after this change include stronger source, image, task-suite, adapter, and telemetry provenance.
