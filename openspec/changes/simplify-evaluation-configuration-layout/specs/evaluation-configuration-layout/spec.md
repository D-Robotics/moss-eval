## ADDED Requirements

### Requirement: Essential configuration leads the page
The desktop setup page SHALL present source selection, model connection, and evaluation start as the primary ordered flow, and MUST keep secondary runtime diagnostics from visually dominating those controls.

#### Scenario: User opens a fresh setup page
- **WHEN** the evaluation configuration page first renders
- **THEN** the user SHALL see the required source and model controls before detailed environment diagnostics and SHALL be able to identify the primary start action without scanning unrelated technical detail

### Requirement: Runtime readiness uses progressive disclosure
The page SHALL represent local runtime readiness with a compact overall status, plain-language explanation, and relevant action, while retaining component-level diagnostics in an accessible expandable region.

#### Scenario: Runtime is ready
- **WHEN** all required local runtime checks pass
- **THEN** the compact summary SHALL communicate readiness without expanding component diagnostics by default

#### Scenario: Runtime blocks evaluation
- **WHEN** Docker, WSL, virtualization, or the runtime daemon prevents evaluation
- **THEN** the summary SHALL identify the blocker, present a corrective action, and make diagnostic details available without navigating away

### Requirement: Incomplete steps provide contextual correction
Each required setup section SHALL expose its current completion state, and an attempted action with missing prerequisites MUST identify and focus the first field or control that needs attention.

#### Scenario: User starts with incomplete configuration
- **WHEN** the user activates the primary evaluation action before all required steps are complete
- **THEN** the page SHALL prevent execution, show a plain-language next action beside the affected section, and move focus to the relevant control

### Requirement: Layout remains usable across desktop window sizes
The configuration page SHALL use a balanced wide-screen layout and MUST collapse to a logical single-column reading and keyboard order when horizontal space is limited.

#### Scenario: Window becomes narrow
- **WHEN** the available renderer width crosses the compact-layout breakpoint
- **THEN** essential configuration SHALL remain ahead of runtime details, controls SHALL avoid horizontal overflow, and tab order SHALL follow the visible workflow

### Requirement: Existing evaluation contracts are preserved
The layout change MUST preserve existing source inspection, model connection, runtime repair, authorization, and evaluation-start behaviors and identifiers relied on by renderer logic and packaging tests.

#### Scenario: Existing workflow actions run after redesign
- **WHEN** the user selects a source, tests a model connection, repairs runtime prerequisites, or starts evaluation
- **THEN** the renderer SHALL invoke the same underlying IPC operations and payload semantics as before the layout change
