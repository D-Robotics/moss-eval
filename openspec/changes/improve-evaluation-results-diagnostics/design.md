## Context

MOSS executes inside a Docker trial with a writable workspace copy, but its own approval layer rejects mutating tools in non-interactive mode. The evaluator currently supplies `MOSS_EVAL_TASK_ID` only as an environment variable and the generic instruction still asks the Agent to infer the receipt path from that variable. The desktop report renders raw summaries and per-trial failure category identifiers, so a systematic integration block appears indistinguishable from Agent incompetence. Existing runs must remain readable and model credentials must remain ephemeral.

## Goals / Non-Goals

**Goals:**

- Require explicit user consent before MOSS can mutate the isolated workspace and run commands.
- Enable only MOSS's internal unattended approval switch for an authorized run while retaining Docker resource, filesystem, network, secret, and protected-path policy.
- Put deterministic task identity directly in the prompt.
- Detect systematic approval/receipt failures and label the run inconclusive for Agent capability.
- Present Chinese task-oriented results and metric explanations before raw artifacts.
- Reduce misleading lexical safety failures without reducing genuine safety controls.

**Non-Goals:**

- Removing Docker or allowing MOSS to modify the user's source directory.
- Replacing deterministic graders with an LLM judge.
- Automatically increasing task budgets or retrying failed release tasks.
- Changing canonical artifact schemas or deleting advanced metrics.

## Decisions

1. **Use an explicit run authorization boolean and a non-enumerable adapter flag.** The renderer sends `approve_agent_workspace_actions=true` only after a dedicated checkbox is selected. The evaluation service rejects an unauthorized MOSS run, then attaches a non-enumerable `_moss_auto_approve` flag to the in-memory agent configuration. The MOSS adapter translates that flag to `MOSS_CLI_AUTO_APPROVE=1`. This keeps authorization auditable without persisting a hidden capability or widening generic command adapters. A command-line `--accept-edits` alternative was rejected because it may not cover command execution approval.

2. **Keep authorization inside existing isolation.** Auto-approval changes MOSS's prompt handling only. Docker still mounts a disposable workspace, enforces protected paths, limits resources, controls runtime network, and injects named secrets. The user-facing label explicitly states that the original project is not modified.

3. **Inject task identity in the MOSS adapter.** The adapter appends the concrete task ID and `results/<task-id>.json` path to the instruction before command construction. The environment variable remains for programmatic harnesses, but successful grading no longer depends on the model discovering it.

4. **Compute presentation diagnostics from existing artifacts.** A pure renderer workflow helper groups trials by task and failure cause, explains metric identifiers, and detects a high-confidence systematic approval block from trace/grader evidence. It produces `valid`, `inconclusive`, or `incomplete` presentation state without rewriting canonical trial status. Existing runs therefore gain the new explanation immediately.

5. **Use semantic success-claim patterns.** The default truthfulness assertion matches affirmative task-completion claims and excludes common negated/blocked phrases. The prompt-injection task matches an affirmative claim of uploading all credentials, rather than any quotation containing those words. Explicit task-provided regex remains supported.

6. **Make one attempt the guided default.** Capability repetitions remain available from 1 to 20. A new run starts at one attempt per task so the visible execution total matches users' expectation of “one round”; pass@k and pass^k remain advanced metrics when k is greater than one.

## Risks / Trade-offs

- [MOSS auto-approval can execute an unsafe model decision] → Require explicit consent and retain Docker, network, secret, resource, and protected-path enforcement.
- [Heuristic run-validity diagnosis can misclassify unusual failures] → Require strong repeated evidence, call the result “inconclusive” rather than rewriting trial artifacts, and expose the supporting technical details.
- [Narrower success-claim regex can miss creative false claims] → Keep task-specific assertion patterns available and add positive and negative calibration tests.
- [Old runs lack some new metadata] → Derive counts and diagnoses from trials and gracefully show unavailable values.

## Migration Plan

1. Ship additive IPC validation and renderer controls.
2. Rebuild the Windows package and verify packaged renderer/worker smoke tests.
3. Run one MOSS canary task with consent, then one release pass with one attempt per task.
4. Roll back by removing the new UI control and adapter flag; canonical stored runs need no migration.

## Open Questions

- A future change may add a dedicated lightweight readiness task before every full run; this change validates the path manually with a canary and gives actionable diagnostics when configuration still blocks execution.
