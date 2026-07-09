# TT-Agent-Plus-727 Design Spec

## Summary

TT-Agent-Plus-727 is a SillyTavern/TauriTavern extension for AIRP workflows. Its core idea is:

> World book entries are no longer fed directly to the final generation model. They become source material for user-configured sub-AI workers. Processed results are cached and injected into the final prompt only when relevant.

The display name is `TT-Agent-Plus-727`. The repository and internal extension folder use `tt-agent-plus-777727` / `TT-Agent-Plus-777727`. The single slash command is `/777`.

## Goals

- Let users define custom worker rules for processing characters, world book entries, scenes, relationship data, and other AIRP context.
- Reduce final prompt pressure by replacing direct world book injection with processed, targeted prompt material.
- Keep final reply generation on the native ST/TT streaming path.
- Provide one clear visual entry through the ST magic-wand menu and one keyboard entry through `/777`.
- Put all plugin features in one main interface: overview, tasks, rules, cache, Debug, and settings.
- Support Chinese-only UI for the first version.
- Support light/dark themes and Android-friendly responsive layout.
- Provide useful Debug output: request lifecycle, cache hits, prompt injection, token estimates, approval decisions, and failures.

## Non-Goals

- Do not replace the final ST/TT streaming generation path.
- Do not directly disable or mutate user world book entries in version 1.
- Do not expose multiple scattered UI entry points such as floating balls, bottom docks, separate settings pages, or extra toolbar buttons.
- Do not require TT Agent API streaming support.
- Do not implement a broad RAG/vector database system in version 1.
- Do not support languages other than Chinese in version 1.

## Product Naming

| Purpose | Value |
| --- | --- |
| Display name | `TT-Agent-Plus-727` |
| Repository | `TT-Agent-Plus-777727` |
| Extension folder/id | `tt-agent-plus-777727` |
| Settings key | `tt_agent_plus_777727` |
| Slash command | `/777` |
| Magic-wand label | `TT-Agent+` or `AIRP 编排器` |
| Main panel title | `TT-Agent-Plus-727` |

The magic-wand menu label must be short because the menu is narrow. The full product name appears inside the main panel.

## Compatibility Strategy

The extension targets ST-native extension APIs first because TT Agent API currently rejects `stream: true` for Agent runs. The final user-visible reply should continue through the normal ST/TT streaming generation path.

TT-specific APIs may be used later for optional background processing or deeper prompt snapshot access, but version 1 should work as a normal ST extension where possible.

Primary ST surfaces:

- Magic-wand menu: append one AIRP menu item.
- Slash command parser: register `/777`.
- Generation interceptor / prompt injection: inject processed material before final generation.
- Extension settings: persist user configuration.
- Local storage / IndexedDB: persist larger processed cache entries.

## Main UX

### Entry Points

There are exactly two user-facing entry points:

1. Magic-wand menu item.
   - Label: `TT-Agent+` or `AIRP 编排器`.
   - Opens the main panel.
   - Shows a small badge only when user action is required, such as approval or failure.

2. Slash command `/777`.
   - Opens the same main panel.
   - No subcommands in version 1.
   - The command exists as a keyboard shortcut, not a separate command surface.

The extension must not add a floating ball, bottom status dock, extra settings button, or unrelated page entry.

### Main Panel

The main panel contains all functions:

- `总览`: current queue, active workers, cache hit rate, estimated prompt injection, approvals required.
- `任务`: worker runs, queue, retries, cancellation, child dispatch requests.
- `规则`: worker rule templates and per-task overrides.
- `缓存`: processed entries, source hashes, invalidation status, manual refresh.
- `Debug`: structured diagnostic timeline and export.
- `设置`: global concurrency, approval mode, token budgets, theme, storage controls.

On desktop, the panel opens as a right-side drawer from the chat UI. On Android/narrow screens, it becomes a near-full-width drawer with safe margins.

### Visual Style

- Minimal, utility-first, consistent with ST/TT dark UI.
- Cards use at most 8px radius.
- Dominant colors should stay neutral with teal/blue-green accents.
- No decorative gradients, orbs, or marketing hero layout.
- Use concise Chinese labels.
- Avoid explanatory walls of text in the UI; place deeper explanations in tooltips or Debug details.

### Motion

Motion must be functional and restrained:

- Drawer open/close: 220-280ms slide + fade.
- Magic-wand menu item badge: no constant animation.
- Processing indicator: thin progress bar or subtle pulse.
- Approval/failure: one short attention pulse.
- Honor `prefers-reduced-motion` by disabling nonessential animations.

## Core Concept Model

### Source Material

World book entries, character entries, chat context, and scene data are source material. They are not automatically final prompt material.

Each source item is identified by:

- source kind
- world/book name when available
- entry uid when available
- display name
- content hash
- last processed timestamp
- rule template id

### Rule Template

A rule template tells a worker how to process assigned material.

Fields:

- id
- display name
- description
- system instruction
- output schema
- model/profile selection
- max input tokens
- target output tokens
- allow child dispatch
- max child workers
- max depth
- output mode

Output modes:

- `silent_cache`: no streaming, no chat write, result enters cache.
- `stream_panel`: stream progress or partial result in the TT-Agent-Plus-727 panel, result enters cache.
- `stream_chat`: reserved for later; writes to chat only after stronger message-save semantics are designed.

Version 1 should implement `silent_cache` and panel progress feedback. It may display status changes in the panel without token-level streaming.

### Worker Task

A worker task is one execution unit:

- task id
- parent task id
- assigned source refs
- rule template id
- model/provider profile
- token budget
- dispatch permission
- current state
- result cache ref
- errors/warnings

Task states:

- `queued`
- `running`
- `awaiting_approval`
- `completed`
- `failed`
- `cancelled`

### Dispatcher

Workers do not directly spawn API calls. They may request child dispatch. The global dispatcher reviews the request against policy:

- global concurrency
- max total dispatch count
- max depth
- per-worker child limit
- token budget
- cost mode
- approval mode

Approval modes:

- `off`: never ask.
- `after_threshold`: ask after the configured dispatch threshold.
- `every_dispatch`: ask for every child dispatch.
- `paid_api_only`: ask when the selected API profile is configured as per-request or paid.

The default is `paid_api_only` plus an additional confirmation after 5 total dispatches.

### Processed Cache

Processed results are stored outside the original world book.

Cache keys include:

- stable chat id or scope id
- source content hash
- rule template id and version
- model/profile id
- processing prompt version

Cache entries include:

- source refs
- processed prompt material
- structured summary
- token estimate
- confidence
- warnings
- created/updated timestamp
- invalidation reason when stale

Small settings use extension settings. Larger processed data uses IndexedDB/localforage.

## Prompt Injection

At generation time, the extension:

1. Detects active source material and relevant cache entries.
2. Excludes or ignores original world book material only within the extension's final prompt assembly path.
3. Selects processed entries that match the current chat, character, and user message.
4. Builds a compact processed context block.
5. Injects that block into the prompt payload before final generation.
6. Lets ST/TT continue its native streaming generation.

The extension must not create a visible chat message for processed context unless the user explicitly enables a future chat-writing feature.

Injected material should identify itself as processed context and should be concise. The UI must show estimated injected tokens before generation when possible.

## Debug Mode

Debug mode must be genuinely useful. It shows:

- extension version
- selected model/provider profile for each worker
- queue events
- dispatch decisions
- approval decisions
- cache hit/miss/stale reasons
- source hash changes
- prompt injection token estimate
- generation interceptor activity
- failures with actionable messages

Debug entries should be structured and exportable as JSON. The default view shows a human-readable summary, with raw details expandable.

## Error Handling

The extension should fail soft:

- If worker processing fails, keep original generation available.
- If prompt injection fails, show a clear error and continue without processed material when safe.
- If storage fails, disable cache-dependent features and show a storage warning.
- If `/777` registration collides, show a Debug warning and keep the magic-wand entry.
- If the magic-wand menu cannot be found, retry after extension load and show a Debug warning.
- If a paid API dispatch requires approval, queue the request instead of silently spending another request.

## UI Mockups

Current local mockups:

- `.superpowers/brainstorm/airp-ui-directions.html`
- `.superpowers/brainstorm/airp-entry-motion.html`
- `.superpowers/brainstorm/airp-magicwand-entry.html`

The chosen direction is the magic-wand entry design:

- one magic-wand item
- one `/777` slash command
- one main panel
- no floating ball
- no bottom dock
- no extra scattered entry points

## Phasing

### Phase 1: Extension Shell and Main Panel

- Create ST extension structure.
- Add magic-wand menu item.
- Register `/777`.
- Build the main panel with Chinese tabs.
- Add light/dark theme support.
- Add responsive Android layout.

### Phase 2: Settings, Rules, and Storage

- Persist global settings.
- Add rule template CRUD.
- Add token budget and approval settings.
- Add IndexedDB/localforage cache layer.

### Phase 3: Dispatcher and Worker Queue

- Implement task model.
- Implement queue and global concurrency.
- Implement approval flow.
- Add simulated worker adapter for tests.
- Add real quiet/background generation adapter when API details are confirmed.

### Phase 4: Processed Cache and Prompt Injection

- Store processed results.
- Detect stale cache.
- Build processed context blocks.
- Inject processed material before final generation.
- Keep native ST/TT streaming generation.

### Phase 5: Debug and Polish

- Add structured Debug timeline.
- Add export.
- Add error states.
- Refine animations.
- Verify desktop and Android layouts.

## Open Implementation Checks

These are not product unknowns; they are codebase integration checks to perform before implementation:

- Confirm exact ST extension manifest format used by current target version.
- Confirm the current magic-wand menu container ids and classes.
- Confirm current slash command import paths.
- Confirm the best current prompt injection API: generation interceptor versus extension prompt.
- Confirm available bundled storage libraries in the ST runtime.

## Acceptance Criteria

- Installing the extension adds exactly one visible magic-wand menu item.
- Typing `/777` opens the same main panel.
- The main panel contains all top-level features.
- The UI is Chinese-only, theme-aware, and usable at 390px width without horizontal scrolling.
- The extension can store settings and cache data separately.
- A queued worker can be created, moved through states, and displayed in Debug.
- Approval mode prevents automatic extra per-request API dispatches when configured.
- Prompt injection can add processed material without writing a visible chat message.
- If processing or injection fails, normal generation remains available with a clear warning.
