## Context

The evaluator already has a Node.js CLI, task/runners/graders, JSON run artifacts, and a MOSS-specific source-track path. A preliminary Electron application exists, but it reads an obsolete trial directory layout, resolves core files relative to the development checkout, and starts commands through interfaces that are unsafe or unreliable after packaging. The core also needs stronger separation between unsupported capabilities, invalid evaluation data, and genuine Agent failure.

The intended users are Harness developers and evaluation owners who want to paste a GitHub URL or choose a local directory, understand what will execute, run a reproducible evaluation, observe progress, and export evidence. Repository code is untrusted. Windows is the first desktop platform, and WSL2 plus a Docker-compatible engine are the supported MVP isolation substrate.

The architecture must keep CLI automation available, avoid putting the evaluator into the target Harness repository, and allow MOSS to be the first adapter without making the product MOSS-only. Canonical artifacts, not renderer state or a UI database, remain the source of truth.

## Goals / Non-Goals

**Goals:**

- Deliver an installable Windows desktop client for public GitHub and local-directory sources.
- Preserve the original source and bind every result to immutable source and prepared-target fingerprints.
- Detect known Harnesses statically, support an explicit manifest, and safely configure unknown Harnesses.
- Run source-controlled build and Agent commands only in bounded sandboxes.
- Generalize source preparation and invocation behind adapter and capability contracts.
- Share orchestration and artifact schemas between CLI and desktop.
- Show real-time, honest status including unavailable metrics, not-applicable tasks, budgets, and failure attribution.
- Ship an initial 15–20 task P0 suite whose success criteria are semantically meaningful and regression-ready.

**Non-Goals:**

- Executing arbitrary repository commands directly on the Windows host.
- Fully automatic execution of an unknown Harness without user-reviewed configuration.
- Claiming universal Agent or Harness support in the MVP.
- Private GitHub authentication, remote runners, automatic updater/signing infrastructure, or macOS/Linux desktop packaging in the MVP.
- Real browser/device tasks or full ACP/PTY coverage in the first release; the first release supports the validated one-shot and stream-json paths.
- Making LLM-as-Judge mandatory or allowing it to override deterministic task invariants.

## Decisions

### 1. Keep Electron and extract a reusable core service boundary

Electron remains the desktop shell because the evaluator and prototype are already Node.js-based. Business logic moves behind platform-neutral core service functions used by both the CLI and a desktop evaluation worker:

- `inspectSource(request)`
- `prepareTarget(request, eventSink)`
- `startEvaluation(request, eventSink)`
- `cancelEvaluation(runId)`
- `getRun(runId)` / `listRuns(filter)`
- `exportReport(runId, options)`

The renderer accesses a smaller, schema-validated projection of these operations through preload. The main process owns window and authorization flows; a dedicated Electron utility process or equivalent packaged Node worker owns preparation and runs. It reports a core/API version during handshake.

Alternative considered: call the existing CLI from the renderer/main process. This was rejected because packaged Electron's executable is not a normal `node` binary, parsing terminal output duplicates canonical state, cancellation by PID is unsafe, and broad IPC would remain difficult to constrain.

### 2. Model source, target, and run as separate immutable identities

The data model is deliberately staged:

1. `SourceRecord`: user input, canonical location, resolved Git revision, managed snapshot path, snapshot hash, dirty/exclusion metadata.
2. `InspectionResult`: evidence, candidate adapter, manifest/configuration, warnings, and required approvals; it contains no executed source result.
3. `PreparedTarget`: source hash, adapter/configuration fingerprints, sandbox policy, immutable image digest, capabilities, telemetry level potential.
4. `Run`: prepared-target fingerprint, task-suite/grader versions, repetitions, environment, events, trials, summary, and exports.

Local sources are copied with a streaming, limit-aware snapshotter. GitHub inputs are normalized, ref-resolved to full SHAs, and cloned into managed storage. Later stages never mount the original source. Hashes include normalized file paths, file type/mode relevant to execution, content, exclusions policy, and manifest/profile content.

Alternative considered: evaluate the user's local checkout in place for speed. This was rejected because builds may mutate the checkout, symlinks can escape the intended root, results become non-reproducible while files change, and cleanup is unsafe.

### 3. Replace MOSS source-track branching with Target Providers and adapters

`source-track.mjs` is decomposed into generic source resolution, inspection, sandbox build, and target storage. Harness-specific behavior lives in registered adapters. The first built-in adapter wraps MOSS's native entry points and telemetry. A `manifest` adapter handles the standard `.moss-eval/harness.json` contract. Guided configuration produces an evaluator-owned profile bound to a source fingerprint; it does not silently write into the target repository.

Adapters are loaded from a trusted application registry for the MVP. Repository manifests select and configure allowed adapters but do not load arbitrary JavaScript into the desktop process. Each adapter implements versioned compatibility, inspection evidence, preparation plan, launch description, event normalization, capability declaration, and fingerprinting.

Alternative considered: dynamically import adapter code from the evaluated repository. This was rejected because it would execute untrusted code in the privileged evaluator process and make adapter provenance unverifiable.

### 4. Use capabilities and telemetry levels as scheduling contracts

Tasks declare required interaction modes, tools/environment, sandbox features, and minimum telemetry. Prepared targets declare what the verified adapter and build expose. A matcher produces `eligible` or `NOT_APPLICABLE` plus evidence before scheduling.

Telemetry is normalized into levels:

- L0: final output and environment state.
- L1: structured tool-call events.
- L2: model, token, latency, and cost-related events.
- L3: Harness lifecycle such as sessions, compaction, retries, recovery, and subagents.

Metrics declare their minimum fields instead of assuming every Harness has MOSS instrumentation. Missing data yields `unavailable` plus coverage, never a fabricated zero. Comparisons default to the common eligible task intersection and show total coverage alongside it.

Alternative considered: treat unsupported tasks as failures to produce one simple number. This was rejected because it confounds product capability coverage with reliability and makes comparisons misleading.

### 5. Make canonical artifacts an append-safe event-derived source of truth

Both CLI and desktop use the current trial layout:

`runs/<run-id>/trials/<task-id>/<agent-id>/trial-<n>/`

The worker writes versioned, atomic checkpoints and normalized events; summaries are derived from trial artifacts. The UI may maintain a rebuildable index for search and thumbnails, but deletion or corruption of that index cannot change evaluation truth. Run IDs combine time with collision-resistant entropy. Reader compatibility is explicit by schema version.

Worker-pool boundaries catch per-trial errors and write structured terminal results. Only target-integrity, storage, or scheduler-invariant failures stop the full run. Cancellation first stops admission, then requests cooperative stop, then force-terminates the owned sandbox after a deadline.

Alternative considered: keep renderer memory as the live source and write only a final report. This was rejected because renderer reloads, crashes, and long-running evaluations would lose state and partial evidence.

### 6. Enforce sandbox and authorization policy outside repository control

All repository-controlled preparation and launch commands run in Docker-compatible containers under WSL2. The evaluator generates the container policy; manifests cannot weaken it. Defaults include no network, no privileged mode, no Docker socket, no host namespaces, a read-only prepared target where practical, writable per-trial workspace, bounded CPU/memory/PIDs/disk/time, and explicit artifact egress paths.

Network permissions use declared purposes and scoped destinations where the runtime supports them. Clone credentials belong to source acquisition and are never copied into images or target runtime. Other secrets are named inputs granted for one operation/run, injected through a non-logged mechanism, and covered by event/artifact redaction. Certain privileges remain categorically prohibited rather than user-approvable.

Alternative considered: show a single “trust this repository” prompt and permit host execution. This was rejected because informed consent requires knowing concrete effects, and one prompt cannot safely cover filesystem, credentials, network, and container-control escalation.

### 7. Treat task quality as product code

Only 15–20 P0 tasks enter the release-gated MVP suite. Existing tasks whose Oracle checks only evidence/receipt formatting remain experimental until they gain semantic final-state invariants, controlled fixtures, positive/negative controls, capability declarations, budgets, and review metadata. Transcript checks diagnose tool use and safety but do not impose a single exact path where alternatives are valid.

LLM-as-Judge is an optional, separately reported grader for qualitative criteria. Rubrics remain structured objects with explicit schemas, partial credit, and `uncertain`. External judging is disabled until the user configures a provider and authorizes the disclosed data fields. Release use requires calibration against human labels.

Alternative considered: add an LLM judge to every task. This was rejected because it increases cost and variance and can conceal weak deterministic Oracles for tasks whose final state is objectively testable.

### 8. Package immutable resources and place all mutable state under user data

Development resolves the project root from the checkout. Packaged mode resolves read-only resources from Electron's `process.resourcesPath`; mutable paths derive from `app.getPath('userData')`, with subdirectories for `config`, `sources`, `targets`, `runs`, `cache`, and `logs`. No code assumes the current working directory or writes under the installation directory.

The Windows MVP produces NSIS installer and portable builds. CI starts from a clean checkout, installs locked dependencies, packages the application, verifies the core/worker handshake and resource lookup, and checks user-data placement and canonical run reading. Generated `dist`, dependencies, local configuration, secrets, and run/cache data remain ignored.

Alternative considered: bundle a second full Node installation and keep shell-spawning the CLI. This adds size and update/version skew while preserving fragile text/process integration, so the preferred design uses Electron's supported utility-process mechanism with a bundled core entry point.

### 9. Stage the implementation behind compatibility seams

The change is delivered in four stages:

- Phase 0: correct canonical artifact reading, run ID/cost/rubric/trial-isolation defects, data paths, packaged worker startup, IPC validation, and renderer security.
- Phase 1 (MVP): public GitHub and local snapshots, MOSS plus manifest adapter, Docker/WSL doctor and sandbox, one-shot/stream-json, hardened P0 suite, live dashboard, history/export, installer and portable artifacts.
- Phase 2: private GitHub, expanded guided/runtime detection, ACP/PTY, optional LLM judge UX, richer comparison and interrupted-run recovery.
- Phase 3: real browser/device sandboxes, remote runners, signing/update service, and additional operating systems.

The UI and core expose unsupported later-phase features explicitly rather than accepting them and degrading silently.

## Risks / Trade-offs

- [Windows sandbox prerequisites create onboarding friction] → Provide a non-mutating doctor, exact failed checks, remediation, retry, and allow source inspection before prerequisites are ready.
- [Docker network controls vary by engine] → Treat the policy actually enforced by the runtime as provenance, deny when required isolation cannot be verified, and do not overclaim destination-level filtering.
- [Static Harness detection can be wrong] → Show evidence and confidence, require confirmation for ambiguity, validate inside the sandbox, and bind profiles to source hashes.
- [Copying large local repositories costs time and disk] → Apply exclusions and limits, stream hashing/copying, deduplicate immutable snapshots by fingerprint, and show size before preparation.
- [MOSS telemetry schema may evolve] → Keep telemetry normalization in the MOSS adapter, version native event contracts, retain raw redacted events, and report achieved level/coverage.
- [A broad adapter API can become unstable] → Version a minimal data contract, keep adapters declarative where possible, and add adapter conformance fixtures before admitting more built-ins.
- [Long-running workers or containers may survive crashes] → Persist ownership metadata, reconcile on startup, terminate only resources carrying evaluator-owned labels, and never kill arbitrary PIDs.
- [LLM judges can leak code or produce unstable scores] → Default them off, disclose fields/providers, redact, calibrate, allow uncertain, and keep deterministic pass independent.
- [Historical artifacts may not match the canonical schema] → Provide versioned readers or an explicit copy-on-migrate command; never overwrite original runs during migration.
- [Supporting only 15–20 gated tasks reduces headline coverage] → Label broader tasks experimental and prioritize trustworthy semantic coverage over an inflated task count.

## Migration Plan

1. Freeze and document the current artifact schema and add compatibility fixtures for existing valid CLI runs.
2. Fix shared core correctness issues: trial error isolation, unique IDs, unknown cost, structured rubric handling, and canonical readers.
3. Introduce user-data path resolution and generic source/target records alongside the existing MOSS source-track path.
4. Implement the adapter registry and move MOSS preparation/telemetry behind it, comparing old and new MOSS runs on controlled fixtures.
5. Introduce capability matching, telemetry coverage, and `NOT_APPLICABLE`; version summary schemas and keep a compatibility reader.
6. Replace desktop IPC/process launch and artifact readers with the worker/core API, then enable live event projection and history rebuilding.
7. Add sandbox authorization, doctor, manifest/guided flows, and harden the P0 tasks.
8. Package and smoke-test installer/portable builds from clean CI, then gate release on security and evaluation-quality tests.

Rollback keeps the existing CLI entry points available during Phases 0–1 and writes new-schema runs to separate run directories. If desktop release gates fail, do not publish the installer; canonical artifacts created by tested CLI paths remain usable. Artifact migration is copy-on-write so rollback never requires destructive conversion.

## Open Questions

- Which exact MOSS native telemetry version and event types define the first stable L1–L3 adapter contract?
- Which 15–20 existing tasks have sufficiently realistic fixtures to harden first, and which should be replaced rather than repaired?
- Does the MVP require destination allow-list enforcement for build network, or is explicit all-outbound build approval acceptable when the installed Docker engine cannot enforce a narrower policy?
- What retention limits and user controls should apply to source snapshots, prepared images, raw traces, and runs?
- Will the first public release be unsigned, organization-signed, or internal-only while code-signing infrastructure is prepared?
