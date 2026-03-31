# Current Runtime Analysis

- **Status**: Grounding document
- **Created**: 2026-03-30

This document records the current runtime reality of the repository. It is intentionally factual.
It exists to prevent speculative protocol design from drifting away from the current codebase.

It does **not** define the target runtime protocol. That comes later.

## Scope

This analysis is based on the current daemon, backend, IPC, and core agent layers:

- `apps/free/cli/src/daemon/run.ts`
- `apps/free/cli/src/daemon/sessions/*`
- `apps/free/cli/src/backends/*`
- `apps/free/cli/src/agent/*`
- `packages/core/src/interfaces/agent.ts`
- `packages/core/src/implementations/agent/*`
- `apps/free/cli/src/api/apiSession.ts`
- `apps/free/cli/src/daemon/ipc/protocol.ts`

## 1. Runtime execution chain

The current execution chain is already runtime-centric, but the layers overlap.

### 1.1 Daemon is the real runtime host

`apps/free/cli/src/daemon/run.ts` registers concrete session classes at startup:

- `claude-native`
- `claude`
- `codex`
- `gemini`
- `opencode`
- `cursor`

This means the daemon is already the place where agent-specific runtime implementations are selected.

### 1.2 Session orchestration lives in `AgentSession`

`apps/free/cli/src/daemon/sessions/AgentSession.ts` is the current orchestration center.
Its own header comment lists the responsibilities it owns today:

- API client creation and `getOrCreateSession`
- offline and reconnection handling
- Free MCP server lifecycle
- unified message queue for CLI and App input
- pre-init message buffering
- backend output to server and IPC
- signal handling and graceful shutdown

Subclasses mainly provide:

- `agentType`
- `createBackend()`
- mode extraction / hashing helpers

This confirms that current runtime complexity is concentrated in daemon session classes, not in the UI.

### 1.3 Server communication is session-scoped and socket-based

`apps/free/cli/src/api/apiSession.ts` manages the daemon's long-lived server connection for a session.
It currently owns:

- websocket connection setup
- reconnect and replay behavior
- outbox flushing
- message fetching and replay sequencing
- metadata, agent state, and capability versioning
- encrypted wire payload handling

This means the current daemon runtime is not only process orchestration. It also owns a large part of session-to-server synchronization.

## 2. Current abstraction layers

The current repository has multiple abstraction layers for agent integration. They overlap.

### 2.1 Core universal backend interface already exists

`packages/core/src/interfaces/agent.ts` defines `IAgentBackend`.
Current core responsibilities include:

- `startSession()`
- `sendPrompt()`
- `cancel()`
- `onMessage()`
- optional permission response
- optional wait-for-complete
- optional load-session / resume
- factory registry and creation helpers

This is already a universal backend contract at the core layer.

### 2.2 CLI daemon has a second backend interface

`apps/free/cli/src/daemon/sessions/AgentBackend.ts` defines a second interface, also named `AgentBackend`.
It adds daemon-specific concerns on top of core:

- `start()` with daemon session dependencies
- `sendMessage()`
- `abort()` / `stop()`
- `output: PushableAsyncIterable<NormalizedMessage>`
- optional `capabilities: PushableAsyncIterable<SessionCapabilities>`
- optional `setModel()` / `setMode()` / `setConfig()` / `runCommand()`
- optional PTY support

The file explicitly states that this layer is **not** responsible for session lifecycle, offline reconnection, IPC, or DB storage. Those remain in `AgentSession`.

### 2.3 CLI `agent/*` is a third overlapping layer

`apps/free/cli/src/agent/*` contains another abstraction surface:

- `agent/core/fromCore.ts`
- `agent/core/AgentRegistry.ts`
- `agent/factories/*`
- `agent/transport/*`
- `agent/acp/index.ts`

This layer partly re-exports core ACP types and session handlers, and partly adds transport and registry helpers.

Current conclusion:

- `core` has a universal backend abstraction
- `cli/daemon/sessions` has a daemon-oriented backend abstraction
- `cli/agent` has an additional wrapper/registry/transport abstraction

This is one of the main reasons the runtime shape feels duplicated.

## 3. Current message and event reality

### 3.1 `NormalizedMessage` is the real canonical runtime payload today

`apps/free/cli/src/daemon/sessions/types.ts` is explicit:

- backend output is converted into `NormalizedMessage`
- daemon IPC broadcasts `NormalizedMessage`
- server DB stores `NormalizedMessage`
- app renders `NormalizedMessage` directly

This is the most important current fact.

The repository does **not** currently center runtime behavior on a separate `DriverEvent` protocol.
It centers runtime behavior on `NormalizedMessage` plus a few side channels.

### 3.2 Event messages are embedded inside `NormalizedMessage`

Operational and product events currently appear as:

- `role: 'event'`
- `content: AgentEvent`

`AgentEvent` currently includes persisted App-visible events such as:

- `switch`
- `message`
- `limit-reached`
- `ready`
- `daemon-log`

It also includes daemon-only operational events such as:

- `status`
- `token_count`
- `error`
- `permission_request`

This means the current system does not have a clean separation yet between:

- user-visible canonical messages
- runtime operational events
- backend lifecycle signals

### 3.3 Ready semantics are already important

`AgentBackend.ts` documents a hard contract around the `ready` event.
The end of an agent turn is currently signaled through an event-shaped `NormalizedMessage`.

This is a real current invariant. Any future protocol must preserve explicit turn completion semantics.

## 4. Current capability reality

### 4.1 Capability data is session-level and UI-oriented

`apps/free/cli/src/daemon/sessions/capabilities.ts` defines `SessionCapabilities`.
Today it mainly contains:

- `models`
- `modes`
- `configOptions`
- `commands`

This is narrower than the target architecture's richer capability model.
Current capability data is mostly there to drive session controls in clients.

### 4.2 ACP capability mapping is already normalized once

`apps/free/cli/src/backends/acp/mapAcpSessionCapabilities.ts` maps ACP session metadata into `SessionCapabilities`.
This mapping currently handles:

- discovered models
- discovered modes
- config option flattening
- available command updates
- current mode and current model tracking

This means one normalization step already exists, but it is specifically focused on session controls rather than general runtime behavior.

### 4.3 Capabilities are streamed as full snapshots

`AgentBackend.ts` states that backends should emit full capability snapshots rather than partial patches.
`DiscoveredAcpBackendBase.ts` maintains and publishes a `capabilitiesSnapshot`.

Current conclusion:

- capability updates are already treated as a stream
- capabilities are currently session-scoped in practice
- capabilities are not yet the broader cross-layer difference model discussed in the target architecture

## 5. Current ACP backend reality

### 5.1 ACP backends are wrappers around core backends

`apps/free/cli/src/backends/acp/DiscoveredAcpBackendBase.ts` wraps core `IAgentBackend` implementations.
It currently does the following:

- creates a core ACP backend
- listens to raw core `AgentMessage`
- maps messages into `NormalizedMessage`
- publishes `SessionCapabilities`
- handles permission mode mapping
- builds Free MCP server configuration
- manages per-turn trace IDs
- buffers idle status to preserve ready ordering

So the current daemon backend layer is mostly an adapter from core message streams into daemon-normalized session streams.

### 5.2 Concrete backends are thin specializations

Backends such as `ClaudeBackend`, `CodexBackend`, `GeminiBackend`, and `OpenCodeBackend` largely specialize:

- backend creation
- raw message mapping
- model/mode specifics

This means much of the daemon backend abstraction is already shared, but only inside a subclass hierarchy built around current ACP behavior.

## 6. Current IPC protocol reality

`apps/free/cli/src/daemon/ipc/protocol.ts` defines the daemon-client protocol.

Current client-to-daemon commands include:

- `attach`
- `detach`
- `send_input`
- `abort`
- `set_model`
- `set_mode`
- `set_config`
- `run_command`
- `spawn_session`
- `pty_data`
- `pty_resize`
- `switch_mode`
- `attach_session`

Current daemon-to-client events include:

- `agent_output` with `NormalizedMessage`
- `capabilities`
- `session_state`
- `session_list`
- `history`
- PTY events
- `mode_switch`

Current conclusion:

- the daemon already exposes a concrete upstream protocol
- that protocol is session-centric and message-centric
- it is not yet framed as a reusable runtime protocol independent of CLI concerns

## 7. Local log grounding (`~/.free`)

The current daemon runtime also leaves a local mirror in `~/.free`.
For the current architecture discussion, the important grounded facts are:

### 7.1 Free session identity and ACP session identity are already separate

For the inspected local session:

- Free session ID: `5e4937208b78490380103a9739182e85`
- persisted ACP resume session ID: `019d3a9c-92b5-77c1-afba-0537eb4a44ea`

This is visible in:

- `~/.free/daemon-sessions/5e4937208b78490380103a9739182e85.json`

Current conclusion:

- the current system already distinguishes product session identity from ACP execution identity
- this distinction is real runtime behavior, not only target architecture intent

### 7.2 Current message handling is a dual async chain

The same user turn currently flows through two concurrent async paths:

- daemon to ACP execution
- daemon to server synchronization

This is visible in local daemon logs:

- daemon receives and routes user input
- `AgentSession` dequeues the turn and sends it to the backend
- ACP prompt is emitted over JSON-RPC `session/prompt`
- ACP returns multiple `session/update` notifications
- daemon continues to enqueue and flush messages to the server

Current conclusion:

- current execution is not a single linear request-response path
- any user-visible completion model must account for both execution-side and sync-side progress

### 7.3 Current ACP turn completion is explicitly signaled by `ready`

`DiscoveredAcpBackendBase.ts` currently waits for `waitForResponseComplete()`, then emits:

- `createNormalizedEvent({ type: 'ready' })`

`AgentSession.ts` also treats `ready` as the authoritative turn-end signal and synthesizes it only as a fallback when a backend returns to idle without emitting it.

Current conclusion:

- the current implementation already has an explicit turn completion signal
- this signal is `ready`, not a guessed abstraction

### 7.4 Current upstream sync completion is explicitly represented by `flush()`

`ApiSessionClient.flush()` currently does two things:

- waits for the HTTP/WebSocket outbox drain
- when connected, waits for a round-trip ping acknowledgement

This makes `flush()` the current authoritative sync-settled boundary.

Current conclusion:

- current message completion cannot be defined from ACP logs alone
- the daemon-to-server sync path has its own completion boundary

### 7.5 Current implementation-level message completion rule

For the current implementation, the smallest grounded message completion rule is:

- ACP turn closed: `ready`
- upstream sync settled: `ApiSessionClient.flush()` completed

This can be summarized as:

- `done = ready + flush completed`

This is not yet the long-term product protocol.
It is the current verified runtime reality.

### 7.6 Current minimal user-visible message lifecycle

Based on the current code and local log grounding, the smallest user-visible lifecycle that can be defended today is:

- `received`
- `running`
- `syncing`
- `done`
- `failed`

Current interpretation:

- `received`: the daemon has accepted the user turn into the session execution path
- `running`: the turn has been dequeued and handed to the backend / ACP execution path
- `syncing`: the ACP side has emitted `ready`, but upstream daemon-to-server sync has not yet fully settled
- `done`: `ready` has been observed and `ApiSessionClient.flush()` has completed
- `failed`: execution-side or sync-side processing has reached an unrecoverable failure state

This lifecycle should be treated as a current implementation analysis result, not yet as a finalized protocol contract.

### 7.7 Current unresolved risks around completion semantics

Even with the grounded `ready + flush completed` rule, a few current questions remain open:

- whether `ready` is always the last turn-scoped persisted output, or whether some turns can still enqueue additional persisted messages after `ready`
- whether the same session can start the next turn while the previous turn is still settling its upstream `flush()`
- whether a single `flush()` failure should be treated as a terminal user-visible failure, or as a transient sync-side condition

Current conclusion:

- `received` and `running` are high-confidence current states
- `syncing` is a useful and grounded product-facing abstraction, but it is not yet a first-class explicit runtime state in code
- `done` and `failed` are directionally grounded, but their exact terminal criteria still require more runtime validation before becoming a formal contract

## 8. Naming conflict: `Attachment`

The current codebase already uses `attachment` heavily to mean file and image attachments.
Examples include:

- `AttachmentRef`
- file transfer callbacks
- fetch attachment callbacks
- upload and download attachment flows

Because of this, `Attachment` is a poor name for any future runtime binding concept.
Using it for runtime process/session binding would be actively misleading.

For future protocol design, runtime binding terminology should avoid `Attachment` entirely.

## 9. Current architectural tensions

The current codebase shows a few clear tensions.

### 9.1 Message normalization is strong, but lifecycle modeling is weak

`NormalizedMessage` is already a real shared format.
However, lifecycle concepts such as:

- runtime binding
- session switching
- invocation routing
- broader capability semantics

are not yet modeled as first-class runtime concepts.

### 9.2 Daemon owns the real runtime, but the abstraction surface is split

The daemon is already the runtime host in practice.
But its abstraction surface is spread across:

- `core/interfaces/agent.ts`
- `cli/agent/*`
- `cli/backends/*`
- `cli/daemon/sessions/*`

This makes it hard to identify the single source of truth for agent integration.

### 9.3 Session and backend concerns are not yet cleanly separated

`AgentSession` owns significant orchestration behavior.
Backends own message mapping and capability publishing.
Core backends own raw agent communication.

The layering works, but the boundaries are descriptive rather than cleanly canonical.

## 10. Implications for the next document

This analysis sets constraints for future runtime protocol design.

The next protocol document should start from these facts:

- the daemon is already the runtime host
- `NormalizedMessage` is already the main shared payload shape
- capability streaming already exists, but in a narrower form
- session lifecycle and backend lifecycle are currently split across multiple abstraction layers
- `Attachment` is a reserved term for file-style payloads and must not be reused for runtime binding

The next document should therefore define a target protocol by explaining:

- which existing abstractions survive
- which existing abstractions collapse into one another
- how current `NormalizedMessage` fits into the target runtime model
- how to evolve capability data without breaking current clients

## Further reading

- `001-overview.md`
- `002-principles.md`
- `003-entity-model.md`

## 11. Formal problem definition

The current runtime architecture should be understood as having six structural problems.
These are the problems future protocol and migration documents must solve.

### 10.1 Abstraction duplication

Agent integration is currently abstracted in multiple overlapping layers:

- `packages/core/src/interfaces/agent.ts`
- `apps/free/cli/src/agent/*`
- `apps/free/cli/src/backends/*`
- `apps/free/cli/src/daemon/sessions/*`

These layers are not cleanly hierarchical. They partially wrap, partially re-export, and partially reinterpret one another.

As a result, the repository lacks a single obvious source of truth for:

- what the real backend contract is
- which layer new agents should implement
- where vendor adaptation formally begins and ends

### 10.2 `NormalizedMessage` semantic overload

`NormalizedMessage` is currently a successful shared payload, but it carries too many different kinds of meaning at once.

It currently acts as:

- backend output format
- daemon IPC payload
- server persistence payload
- app rendering input
- runtime event container
- lifecycle signal carrier

This means the system has strong message normalization but weak separation between:

- product messages
- runtime events
- lifecycle control signals

### 10.3 `AgentSession` as a runtime god object

`AgentSession` currently concentrates too many responsibilities into one orchestration center.
It owns, directly or indirectly:

- server session communication
- reconnect and replay behavior
- message queueing
- backend lifecycle management
- Free MCP server lifecycle
- output piping to server and IPC
- shutdown and recovery behavior

This makes `AgentSession` the practical runtime center, but without a clean internal split between orchestration concerns.

### 10.4 Capability model is too narrow

The current `SessionCapabilities` model is useful, but it is narrowly scoped to session controls and UI-facing configuration.

It mainly captures:

- models
- modes
- config options
- commands

It does not yet represent broader runtime differences such as:

- resume behavior
- session switching support
- invocation support
- approval semantics
- binding/export behavior

This makes the current capability model insufficient as the long-term difference model for a headless runtime.

### 10.5 Runtime reality and codebase self-description diverge

In actual behavior, the daemon is already the runtime core of the system.
However, the codebase does not yet fully describe itself that way.

This mismatch creates confusion about:

- where the product core really lives
- whether `core`, `cli/agent`, or `daemon/sessions` is the runtime source of truth
- which abstractions are foundational and which are transitional

### 10.6 Free session, vendor session, and runtime binding are not fully separated

The target architecture requires a clear distinction between:

- `Session` as the Free-owned working context
- vendor-native session identifiers and lifecycle
- runtime-side session-to-execution binding

The current implementation still lets these concepts sit too close together in orchestration flows.
That makes future work on:

- session switching
- portable snapshots
- multi-agent invocation
- vendor-neutral protocol design

harder than it should be.

## 11. Design pressure for the next documents

Future architecture documents should be evaluated against a simple question:

- does this proposal actually remove the six structural problems above,
- or does it merely rename them while keeping the same shape?

This question should constrain:

- runtime protocol design
- boundary definitions
- migration planning
- naming decisions
