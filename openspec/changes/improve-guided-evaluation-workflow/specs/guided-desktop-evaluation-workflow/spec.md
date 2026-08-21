## ADDED Requirements

### Requirement: Three-step primary journey
The desktop client SHALL present the primary evaluation journey as the ordered steps `选择 Agent`, `配置评测`, and `运行与结果`, while history and reports remain secondary destinations.

#### Scenario: First launch
- **WHEN** a user opens the desktop client without a selected source
- **THEN** Step 1 SHALL be active, Step 2 and Step 3 SHALL visibly indicate that prerequisites remain, and the page SHALL explain how to begin

#### Scenario: Completed prerequisites unlock steps
- **WHEN** source inspection or target preparation completes successfully
- **THEN** the corresponding next step SHALL become available without requiring an application restart

### Requirement: Explanatory navigation guards
The client SHALL respond to every primary-step selection and SHALL explain unmet prerequisites in plain language instead of silently navigating, doing nothing, or displaying only an internal error code.

#### Scenario: Configuration selected before source analysis
- **WHEN** a user selects `配置评测` before importing and analyzing an Agent
- **THEN** the client SHALL remain on Step 1, display `请先选择并分析要评测的 Agent`, and focus or identify the source control

#### Scenario: Run selected before target preparation
- **WHEN** a user selects `运行与结果` before the evaluation environment is prepared
- **THEN** the client SHALL navigate to or retain Step 2 and display the specific remaining preparation action

### Requirement: User-oriented source selection
The source page SHALL ask which Agent the user wants to evaluate, support GitHub and local-folder choices, and describe isolation as using a safe evaluation copy that does not modify the original project.

#### Scenario: GitHub source entry
- **WHEN** the GitHub source mode is selected
- **THEN** the client SHALL show one primary repository URL input, hide revision selection under `高级设置`, and offer a primary `导入并分析` action

#### Scenario: Local source entry
- **WHEN** the local source mode is selected
- **THEN** the client SHALL offer a `选择项目文件夹` action and SHALL NOT require the user to understand the term `隔离快照`

### Requirement: Understandable import and analysis feedback
The client SHALL expose persistent staged feedback while importing and inspecting a source, and SHALL display a concise readiness result with a primary next action when analysis succeeds.

#### Scenario: Analysis in progress
- **WHEN** source import and inspection are active
- **THEN** the initiating control SHALL enter a busy state, duplicate submission SHALL be prevented, and the page SHALL identify the current real operation stage

#### Scenario: Analysis succeeds
- **WHEN** the client successfully imports and inspects a source
- **THEN** it SHALL show the project identity, detected Agent type, discovered entry point or an understandable warning, source version, original-project safety assurance, and `继续配置评测`

#### Scenario: Analysis fails
- **WHEN** source import or inspection fails
- **THEN** entered source values SHALL remain, the page SHALL show a plain-language error and recovery action, and the user SHALL be able to retry

### Requirement: Progressive technical disclosure
Implementation and audit terminology SHALL be hidden from the primary journey and remain available in expandable technical details.

#### Scenario: Ordinary successful inspection
- **WHEN** a user reviews a successful source analysis without expanding details
- **THEN** fingerprint, provenance, adapter evidence, raw manifests, and JSON SHALL NOT dominate the visible summary

#### Scenario: Expert opens technical details
- **WHEN** a user expands technical details
- **THEN** the client SHALL expose the exact source record, inspection evidence, revision, fingerprints, entry points, and applicable backend identifiers

### Requirement: Action-state feedback
Every asynchronous primary action SHALL immediately expose a busy state, prevent duplicate activation, and resolve to an inline success or failure state in addition to any transient notification.

#### Scenario: Connection test activated
- **WHEN** a user selects `测试连接`
- **THEN** the button SHALL indicate that testing is active, repeated activation SHALL be ignored, and the final HTTP-oriented result SHALL remain visible beside the model configuration

#### Scenario: Preparation or run startup activated
- **WHEN** a user starts environment preparation or evaluation startup
- **THEN** the initiating control SHALL communicate the operation state until the backend resolves and SHALL then present the next available action

### Requirement: Inline corrective validation
The client SHALL place validation guidance at the relevant field or step, use user-facing corrective language, and focus the first invalid input.

#### Scenario: Missing local folder
- **WHEN** a user requests local analysis without selecting a folder
- **THEN** the client SHALL display `请先选择电脑上的 Agent 项目文件夹` next to the source controls

#### Scenario: Missing model API key
- **WHEN** a MOSS user starts connection testing or evaluation without an API key
- **THEN** the client SHALL display `请输入 API Key。它只用于本次评测，不会保存` at the API Key field and focus it

#### Scenario: Missing runtime network authorization
- **WHEN** a model operation requires public network access and the authorization is unchecked
- **THEN** the client SHALL identify and focus the authorization control and explain that the provider cannot be reached without this one-run permission

### Requirement: Recoverable state and credential safety
Recoverable failures SHALL preserve non-secret user input and configuration, while API keys SHALL remain in page memory only and SHALL not be copied into persisted draft or diagnostic projections.

#### Scenario: Backend operation fails
- **WHEN** import, preparation, connection testing, or run startup fails recoverably
- **THEN** all non-secret inputs SHALL remain available and the client SHALL provide a retry or remediation action without requiring the user to restart the workflow

#### Scenario: Page reloads
- **WHEN** the renderer reloads after model fields were entered
- **THEN** model, Base URL, and a non-secret protocol override MAY be restored, but the API Key SHALL be empty

### Requirement: Minimal MOSS model configuration
The primary MOSS model configuration SHALL ask for only Base URL, API Key, and model name, and SHALL NOT require a model-service vendor selection.

#### Scenario: MOSS configuration is displayed
- **WHEN** the inspected Agent is identified as MOSS
- **THEN** the visible primary model form SHALL contain editable Base URL, API Key, and model-name controls, and SHALL NOT display a provider or vendor selector

#### Scenario: Generic runtime secrets exist for other adapters
- **WHEN** the inspected Agent is identified as MOSS
- **THEN** generic environment-secret controls SHALL be hidden so the API Key is entered in exactly one place

### Requirement: Automatic API protocol resolution
The client SHALL infer the request protocol from the Base URL by default and SHALL provide an advanced protocol override for custom gateways.

#### Scenario: Custom OpenAI-compatible gateway
- **WHEN** a user enters an unknown HTTPS Base URL and leaves protocol selection on `自动识别`
- **THEN** the client SHALL resolve the connection as OpenAI-compatible and use the URL without requiring a vendor choice

#### Scenario: Official Anthropic endpoint
- **WHEN** a user enters an official Anthropic Base URL and leaves protocol selection on `自动识别`
- **THEN** the client SHALL resolve the connection as Anthropic Messages

#### Scenario: Custom Anthropic-compatible gateway
- **WHEN** a custom gateway uses Anthropic semantics that cannot be inferred from its hostname
- **THEN** the user SHALL be able to expand `高级设置` and select `Anthropic` before testing the connection

### Requirement: Accessible status communication
Workflow state, errors, and busy feedback SHALL be available through text and accessibility attributes rather than color alone.

#### Scenario: Operation status changes
- **WHEN** a primary action changes from idle to busy, success, or failure
- **THEN** a live status region SHALL communicate the change, the initiating control SHALL expose its disabled/busy state, and focus SHALL move to an actionable error target when correction is required
