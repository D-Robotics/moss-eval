# Real Agent failure corpus

This corpus turns retained, attributable Agent failures into regression tasks. It is a governed development asset, not a public leaderboard and not evidence that MOSS has a Professional score.

## Scope and counting

Count a case only when the failed construct belongs to one of these strata:

- `agent-behavior`: planning, context use, tool selection, recovery, or completion behavior produced by the target Agent.
- `agent-harness`: provider adaptation, tool authorization, state management, telemetry, sandboxing, or other runtime behavior that materially changes the Agent result.
- `product-defect`: UI, packaging, formatting, or ordinary repository defects. These remain useful regression tests but are rejected from the Agent-failure count.

Candidate, accepted, reproduced, minimized, task-ready, calibrated, reviewed, piloted, and release-eligible are different lifecycle states. Reports must never replace one term with another.

## Production workflow

1. Collect an authoritative public Issue, pull request, fixed commit, release note, retained evaluation Trace, or explicitly authorized incident.
2. Register immutable evidence identity, allowed use, consent or license basis, retrieval time, privacy class, redaction status, construct, and root-cause family.
3. Triage the candidate. Reject ordinary product defects, unverifiable reports, duplicate mechanisms, prohibited use, or unsafe private evidence explicitly.
4. Reproduce only after explicit execution authorization. The driver uses a fresh temporary workspace for the failing and fixed phases, bounded output and time, pinned revisions, and a declared network policy. It never mutates the source fixture or checkout.
5. Minimize only when the original and reduced failure signatures match. A changed mechanism is `not-preserved` and cannot be promoted.
6. Promote by stratum: MOSS target behavior to `target-regression`, evaluator/runtime behavior to `harness-regression`, portable behavior to `general-capability`, and authorized internal evidence to `private-business`.
7. Calibrate the deterministic outcome Oracle with at least two valid positive controls and three task-specific negative controls, each in a separate workspace. Exact tool order is diagnostic evidence, not the score.
8. Obtain independent domain and evaluation review. Security cases also require privacy/security review.
9. Run a cross-Agent Pilot with at least three Agent families and nine valid observations per task.
10. Publish scored claims only with external hidden Oracles whose digest is pinned. Public fixtures and public development Oracles remain non-release development material.

## Privacy, evidence, and rejection policy

- Never copy API keys, credentials, private prompts, personal data, or raw production conversations into the repository. Secret findings fail the audit.
- Private incidents require explicit use authorization, an internal or stricter privacy class, redaction evidence, and a private distribution track. A public label on private evidence fails closed.
- Public source metadata is paraphrased. The canonical URL and immutable revision retain attribution; mutable summaries alone are insufficient.
- Exact evidence duplicates count once. Related reports may remain in the registry but share a root-cause family and do not inflate accepted coverage.
- Every rejection stays in `rejected-cases.json` with reason codes and rationale. Rejection is evidence of governance, not a missing result.

## Commands

```powershell
npm run failure:audit
node bin/moss-eval.mjs failure-reproduce --corpus datasets/real-failures --case rf-moss-plan-completion-deadlock --authorize --source D:\moss-drobotics
node bin/moss-eval.mjs failure-promote --corpus datasets/real-failures --case rf-moss-plan-completion-deadlock
npm run failure:check
```

`failure-reproduce` refuses to execute without `--authorize`. `failure:reproduce-all` validates every pinned failure/fix pair against `D:\moss-drobotics` without changing that source worktree. CI builds the 21-task development Pilot, audits it, executes all controls, links calibration evidence back to cases, validates the synthetic hidden-evaluation contract, audits packaged/tracked surfaces, and proves that public development evidence cannot open the release gate.

The example policy is in `configs/real-failure-corpus.example.json`. Machine-readable reports are written below `.moss-eval/datasets/`.

## Current pilot and claim boundary

The current catalog contains 21 accepted, source-pinned mechanisms and 3 explicit rejections. All 21 are reproduced, minimized, mapped one-to-one to tasks, and calibrated. Each task has two positive and four negative controls, for 126 control executions in total; current calibration has zero negative false positives and zero execution errors. The corpus size, mapping parity, secret, duplicate, construct-concentration, and source-change-concentration gates pass.

The executable taskpack remains a public development asset. MOSS has completed one frozen-protocol attempt per task, but that is not a stability study and cannot establish pass@k or pass^k for k greater than one. Claude and Codex host-local qualification runs are useful adapter diagnostics but are excluded from formal comparison because they did not run in the same proven isolation environment.

Formal release remains blocked until all of the following exist: two independently implemented Agent families qualified under the same container protocol, repeated attempts, a genuine external private Oracle bundle, a leak audit against that bundle, two distinct human sign-offs, two regression cycles, and a clean packaged Windows-client receipt. Private bundle operations are documented in [PRIVATE_ORACLE_OPERATIONS.md](PRIVATE_ORACLE_OPERATIONS.md).
