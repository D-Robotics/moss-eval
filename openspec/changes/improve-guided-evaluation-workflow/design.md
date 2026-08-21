## Context

The Electron renderer is a dependency-free, programmatic DOM application. It currently exposes five peer tabs and renders backend terminology directly. Navigation is unconditional, asynchronous buttons do not consistently enter a busy state, validation is usually reported by a short-lived toast, and successful source inspection does not present a clear primary next action.

The backend boundaries are already appropriate: source ingestion creates a safe copy, inspection is non-executing, target preparation is sandboxed, model credentials are transient, and evaluation emits progress events. This change therefore treats the renderer as a user-facing state machine over existing APIs rather than changing evaluation semantics.

## Goals / Non-Goals

**Goals:**

- Make the first successful evaluation understandable without knowledge of snapshots, harnesses, adapters, provenance, fingerprints, Docker, or prepared targets.
- Provide three clearly ordered steps with truthful readiness and visible prerequisite guidance.
- Ensure every user action has immediate, persistent-enough feedback and cannot be duplicated while active.
- Preserve user input and provide a direct retry or remediation path after recoverable failures.
- Retain technical and audit data behind progressive disclosure.
- Keep credentials out of persisted workflow state.

**Non-Goals:**

- Changing source ingestion, sandbox, model, task, grading, or artifact semantics.
- Supporting private GitHub authentication or non-Docker execution.
- Replacing the vanilla renderer with a UI framework.
- Redesigning detailed report visualization beyond navigation and terminology needed by the guided flow.

## Decisions

### 1. Model the primary journey as three derived steps

The renderer will present `选择 Agent`, `配置评测`, and `运行与结果`. Step readiness is derived from canonical state rather than stored independently:

- Step 1 is always available.
- Step 2 requires a successfully imported and inspected source.
- Step 3 requires a prepared target; starting a run additionally requires valid model fields and explicit network authorization.

Clicking an unavailable step will keep the current view, focus the relevant recovery control, and render a plain-language prerequisite message. Disabled-looking presentation alone is insufficient because it gives no explanation.

Alternative considered: fully disable later-step buttons. Rejected because users cannot discover why a step is unavailable.

### 2. Use user goals in the primary surface and preserve exact terms in details

Primary wording will use `评测副本`, `自动识别 Agent`, `Agent 类型`, and `评测环境`. Source revision, fingerprint, provenance, adapter evidence, manifest JSON, image digest, and sandbox budgets will remain available under `高级设置` or `技术详情`.

Alternative considered: remove technical information. Rejected because reproducibility and auditability are product requirements.

### 3. Centralize asynchronous interaction feedback

A renderer action helper will manage a button's busy label, `aria-busy`, duplicate-click protection, a persistent inline status region, success/failure styling, and focus movement on failure. Toasts remain supplementary, not the only feedback channel.

Each operation owns its own state so source import, preparation, connection testing, and run startup cannot accidentally block unrelated navigation.

### 4. Separate validation from backend failures

Required-field and ordering errors will be detected before IPC, attached to the relevant field or step, and phrased as a corrective instruction. Backend error codes will be mapped to stable user messages, while the raw code may appear in technical details. Values remain in controls after failure; API keys remain in page memory only.

### 5. Show source work as an understandable sequence

Source ingestion and inspection will be one user action named `导入并分析`. During the operation the page will show staged progress (`正在创建安全副本`, `正在识别 Agent`, `正在检查运行方式`). The backend APIs remain sequential, and stages describe actual boundaries without claiming unsupported byte-level progress.

On success the page shows a concise result card and a primary `继续配置评测` action. It does not auto-navigate, allowing the user to review what was detected.

### 6. Keep history and reports as secondary navigation

History and report access remain available as utility navigation, while only the three primary journey steps receive numbered step styling. This avoids forcing repeat users through the wizard while keeping the first-use path obvious.

### 7. Separate vendor branding from the API wire protocol

The primary MOSS configuration surface will request only `Base URL`, `API Key`, and `模型名`. A vendor selector is not required because the endpoint URL and credentials are the actual user inputs, while MOSS only needs to know which request/response protocol to use.

The renderer and core configuration layer will resolve an `auto` protocol as follows:

- Official Anthropic endpoints resolve to the Anthropic Messages protocol.
- Known OpenAI, DeepSeek, and Qwen endpoints resolve to the OpenAI-compatible Chat Completions protocol.
- Unknown custom HTTPS endpoints default to OpenAI-compatible, which is the most common gateway contract.

An expandable `高级设置` control will allow an expert to override `auto` with `OpenAI Compatible` or `Anthropic`. The resolved protocol is translated to the provider field required by the MOSS runtime. Legacy IPC inputs containing the old provider value remain accepted during migration.

Generic environment-secret controls will be explicitly hidden whenever the selected Agent uses the dedicated MOSS model configuration. CSS will preserve the native `hidden` contract even when layout classes set `display`.

## Risks / Trade-offs

- **Risk: Renderer state becomes more complex.** → Keep readiness derived from existing canonical state and cover transitions with exported pure helpers and packaged smoke tests.
- **Risk: Friendly stage labels imply exact progress.** → Use discrete operation stages only at real API boundaries; do not show fabricated percentages.
- **Risk: Guarded navigation frustrates expert users.** → Explain the missing prerequisite on click and retain technical details plus history/report shortcuts.
- **Risk: Re-rendering can clear API keys.** → Avoid full configuration re-renders during background doctor polling and never include the key in persisted drafts.
- **Risk: Error mapping can hide useful diagnostics.** → Show the corrective user message first and place error codes/details in an expandable technical block.
- **Risk: A custom endpoint uses Anthropic semantics but cannot be inferred from its hostname.** → Default custom gateways to OpenAI-compatible and provide the advanced protocol override before connection testing.

## Migration Plan

1. Add workflow/readiness and feedback helpers with tests.
2. Replace primary tab labels and source page with the guided Step 1 surface.
3. Apply navigation guards and user-facing Step 2 terminology without changing IPC payloads.
4. Add Step 3 empty/running/completed states and retain history/report utility access.
5. Extend renderer and packaged smoke tests, then rebuild the Windows artifacts.
6. Simplify model configuration, retain an advanced protocol override, and verify a custom OpenAI-compatible endpoint without persisting its API key.

Rollback is limited to renderer assets and tests; backend data and stored run artifacts require no migration.

## Open Questions

None for the MVP. Automatic input-type detection and a recent-project home dashboard remain possible follow-up changes.
