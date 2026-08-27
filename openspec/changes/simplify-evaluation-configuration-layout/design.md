## Context

The renderer currently presents configuration as a sequence of large panels. Runtime readiness consumes a disproportionate amount of vertical space even though most users only need a pass/fail summary; source selection, model settings, validation feedback, and the primary action consequently compete for attention. The renderer is plain HTML/CSS/JavaScript, and existing element identifiers and workflow events are consumed by tests and Electron IPC.

## Goals / Non-Goals

**Goals:**

- Put the three user decisions—what to evaluate, which model to use, and when to start—into one readable primary column.
- Reduce runtime readiness to a compact summary with progressive disclosure for Docker, WSL, virtualization, and repair details.
- Keep step status and corrective guidance near the affected controls.
- Preserve keyboard access, responsive behavior, and existing renderer/IPC contracts.

**Non-Goals:**

- Change source ingestion, model validation, Docker installation, or evaluation execution behavior.
- Remove detailed environment diagnostics or automatic repair actions.
- Redesign the evaluation results screen.

## Decisions

### 1. Use a primary flow plus compact readiness rail

On wide windows, configuration sections form the primary content column and runtime readiness becomes a narrower companion card. On narrow windows, the rail stacks below the essential configuration rather than preceding it. This preserves access to diagnostics without making infrastructure terminology the first thing users see.

Alternative considered: retain a single full-width sequence and merely reduce padding. Rejected because the information hierarchy remains unclear even with smaller spacing.

### 2. Make runtime details progressive

The default runtime card shows one overall state, a short explanation, and the relevant action. Component-level checks and technical details live in an accessible disclosure element and expand automatically only when a blocking issue requires diagnosis.

Alternative considered: hide runtime status entirely until start. Rejected because downloading or starting Docker can take time and users need early, actionable feedback.

### 3. Keep existing IDs and event contracts

The markup may be regrouped and new semantic wrappers added, but controls used by renderer logic retain their identifiers. CSS state classes and small workflow helpers drive status presentation without changing IPC request payloads.

Alternative considered: rewrite the setup UI as a component framework. Rejected because it adds migration risk and a new dependency for a focused layout correction.

### 4. Validate at the point of action

Each section carries a compact completion state. Attempting to continue or start focuses the first incomplete field and exposes a plain-language correction adjacent to that section. The start area also summarizes the next unresolved prerequisite.

## Risks / Trade-offs

- [Existing renderer selectors depend on layout structure] → Preserve element IDs, audit selectors, and extend packaged renderer smoke coverage.
- [Technical details become harder to discover] → Keep a clearly labelled “查看环境详情” disclosure and auto-open it for runtime failures.
- [Two-column layout becomes cramped on smaller windows] → Use a breakpoint that returns to a single-column flow and places the primary action after required fields.
- [Uncommitted unrelated cross-agent work exists] → Restrict this change to renderer, UI tests, and its OpenSpec artifacts.

## Migration Plan

1. Introduce semantic layout wrappers while retaining existing controls and IDs.
2. Add compact runtime summary and disclosure behavior.
3. Update validation/status rendering and responsive styles.
4. Run renderer unit/e2e and packaged smoke tests; rollback is limited to the renderer files because no data/API migration is involved.

## Open Questions

None. Existing Chinese copy and visual language remain the baseline for this iteration.
