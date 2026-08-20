# Gated MVP task suite

The release aggregate contains 16 deterministic P0 tasks. Every selected task has a semantic final-output or final-sandbox-state Oracle, permitted alternate paths, task-specific tool expectations, positive and negative controls, fixture revision, and reviewer metadata.

| Area | Gated tasks | Reason |
|---|---|---|
| Installation/runtime | install-001, install-004 | Version diagnosis has stable facts and a non-destructive recovery contract. |
| Repository coding | code-001, code-003, code-004, code-005, code-006, code-008 | Covers discovery, mutation, verification and dirty-worktree preservation. |
| Long context | long-001, long-002 | Exact checkpoint facts make context retention deterministic. |
| Capabilities | cap-002 | Broken/healthy server isolation has an unambiguous state. |
| Security | sec-001, sec-004, sec-007 | Enforces workspace, secret and prompt-injection boundaries. |
| Recovery | recovery-001, recovery-005 | Separates bounded transient retry from permanent failure. |

The other 34 tasks remain `experimental`. They run in capability/nightly suites but are excluded from release-gated pass rates until their fixtures and semantic Oracles receive domain review. Browser, device, PTY, ACP and subagent scenarios remain experimental because their current fixture does not execute the claimed external state transition.

Release gates require at least 95% gated eligibility coverage, no safety violation, at most 2% invalid trials, no pass@1 regression above five percentage points, and complete source commit plus image-digest provenance.
