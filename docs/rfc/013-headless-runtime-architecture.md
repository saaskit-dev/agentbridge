# RFC-013: Headless Runtime Architecture

- **Status**: Proposed
- **Created**: 2026-03-30
- **Author**: Codex + User discussion

> Overview note:
> This RFC is the high-level overview for the headless runtime direction.
> Canonical principles and models now live in `docs/architecture/`.

## 1. Summary

This RFC defines the target architecture for Free as a three-layer system:

1. **App/UI** is a thin rendering and input shell
2. **Server** is an agent-agnostic persistence, auth, sync, and relay layer
3. **CLI/Daemon Runtime** is the only layer that knows vendor agent differences

The central design goal is to make the product operate on **canonical product entities**
instead of vendor-native session models. UI, server, and tests must all consume the same
stable protocol. Agent vendors are adapters behind the runtime boundary.

This RFC also elevates **agent-to-agent invocation** to a first-class runtime capability.

Detailed architecture docs:

- `docs/architecture/README.md`
- `docs/architecture/001-overview.md`
- `docs/architecture/002-principles.md`
- `docs/architecture/003-entity-model.md`

## 1.1 Goal Model

The target system is intentionally simple in shape:

- **App/UI** renders canonical data and dispatches canonical commands
- **Server** persists canonical state, relays canonical events, and enforces agent-agnostic policy
- **Runtime** owns vendor differences, lifecycle control, capability normalization, and orchestration

This RFC does not treat the UI as the product core. The product core is the runtime plus the
canonical protocol.

## 2. Problem Statement

The current codebase has useful layers, but the actual responsibility split is not enforced:

- App contains runtime orchestration and synchronization logic
- Server contains session and socket flows mixed with process-wide singletons
- CLI/Daemon contains the real runtime, but its abstractions are not yet the single source of truth
- Agent-specific behavior leaks into places that should be vendor-agnostic

The result is familiar:

- UI is hard to keep thin
- feature logic spreads across app, server, and daemon
- vendor differences leak upward
- session semantics are defined by implementation details instead of product rules
- testing is expensive because behavior depends on side effects and process-level state

## 3. Design Goals

### 3.1 Primary goals

- App remains almost entirely free of business and runtime logic
- Server remains ignorant of vendor-specific agent behavior
- Runtime becomes the only home for vendor differences and lifecycle control
- All product-facing layers operate on canonical Free protocol types
- Session identity belongs to Free, not to Claude, Codex, Gemini, or any other vendor
- Agent-to-agent invocation is supported without leaking vendor details to app or server

### 3.2 Secondary goals

- New UI shells should be cheap to add: iOS, Android, Web, TUI, integration test harness
- New agent vendors should be cheap to add by implementing one driver contract
- Session switching between agents should be possible through canonical snapshots
- Domain logic should be unit-testable without React, sockets, or child processes

### 3.3 Non-goals

- Perfect lossless migration between all vendor-native sessions
- Erasing all vendor-specific capability differences
- Immediate full rewrite of the repository

## 3.4 First-phase scope

The first phase of the refactor should establish the model and boundaries, not build the final
feature-complete system.

The first phase should achieve:

- app as rendering shell plus presentation mapping only
- server as vendor-agnostic persistence and relay layer
- runtime as the only owner of vendor adaptation and agent lifecycle
- canonical entities defined explicitly in shared protocol types
- capability differences exposed through structured capability data

The first phase does **not** need to achieve:

- perfect `switchAgent()` behavior
- a full workflow engine
- full multi-agent collaborative orchestration
- zero local runtime in app processes
- immediate extraction of `packages/runtime`

## 4. Architecture Principles

Detailed principles are maintained in:

- `docs/architecture/002-principles.md`

## 5. Target Layers

### 5.1 App/UI layer

Responsibilities:

- render canonical view data
- collect user input
- dispatch canonical commands
- subscribe to canonical view state

Explicitly out of scope:

- socket lifecycle
- session recovery orchestration
- vendor branching
- encryption
- storage internals
- revenue, push, or background workflow orchestration

The app should be replaceable by another shell with minimal runtime changes.

### 5.2 Server layer

Responsibilities:

- authentication and authorization
- persistence
- event relay and fanout
- coordination and shared state
- sync and replay
- policy enforcement that is vendor-agnostic

Explicitly out of scope:

- vendor process management
- ACP / SDK / MCP dialect handling
- vendor permission quirks
- vendor-native session reconstruction

### 5.3 Runtime layer

Responsibilities:

- vendor driver management
- agent lifecycle
- attach, detach, resume, interrupt
- capability discovery and normalization
- canonical event emission
- canonical command translation
- session snapshot export/import
- agent-to-agent invocation

This is the core product kernel.

## 6. Core Product Entities

Detailed canonical entities are maintained in:

- `docs/architecture/003-entity-model.md`

## 7. Protocol Boundaries

The target system uses three protocol surfaces.

### 7.1 UI Protocol

Used by app shells and test harnesses.

Commands:

- `createSession`
- `sendInput`
- `interruptSession`
- `approveToolCall`
- `denyToolCall`
- `invokeAgent`
- `switchAgent`

View models / streams:

- `SessionView`
- `MessageView`
- `TaskView`
- `ParticipantView`
- `ToolCallView`
- `ActivityView`

The UI Protocol must never expose vendor-specific event formats.

### 7.2 Server Protocol

Used between UI shells and server, and between server and runtime.

It carries canonical entities and canonical events only.

Server protocol examples:

- session state sync
- event relay
- presence and attachment state
- auth and policy decisions
- replay and hydration

The server must not need to know whether the runtime is speaking to Claude ACP,
Codex MCP, Gemini ACP, or any future provider.

### 7.3 Runtime Driver Protocol

Used inside the runtime between the canonical runtime and each vendor driver.

This is where vendor-specific translation is allowed.

Driver inputs:

- `startSession`
- `resumeSession`
- `sendInput`
- `interrupt`
- `approveToolCall`
- `denyToolCall`
- `exportSnapshot`

Driver outputs:

- capability reports
- canonicalized events
- vendor-state references
- snapshot fragments

## 8. Agent-to-Agent Invocation

Agent-to-agent interaction is a runtime-native feature, not a prompt convention.

Two forms are supported:

1. **Capability invocation**
   One agent calls another agent as a capability provider
2. **Collaborative participation**
   Multiple agents participate in the same Free session and task graph

This feature belongs in runtime because only runtime knows:

- which agents exist
- what capabilities they expose
- what policy boundaries apply
- how to route and observe invocation lifecycle

Neither app nor server should implement vendor-specific cross-agent coordination.

## 9. Session Switching

The target model supports switching the active vendor agent inside one canonical Free session.

This does **not** assume lossless migration of vendor-native internal state.
Instead, switching works through a Free-owned snapshot.

### 9.1 Canonical session snapshot

Snapshot contents should include:

- canonical message history
- task and invocation history
- tool call history
- permissions and policy state
- attachments and artifacts
- cwd / repo context where applicable
- summarized working memory when required

### 9.2 Switching model

`switchAgent(sessionId, targetAgent)` means:

1. export current canonical snapshot
2. bootstrap target driver from snapshot
3. rebind the Free session to the new runtime attachment
4. continue emitting canonical events

This is a product-level continuity guarantee, not a vendor-native session guarantee.

## 10. Package and Repository Direction

The repository should move toward the following conceptual structure:

```text
packages/core
  canonical protocol, shared types, event schema, capability model

packages/runtime
  headless multi-agent runtime kernel
  driver registry
  orchestration and invocation

apps/free/cli
  runtime host / daemon host / shell entrypoint

apps/free/server
  auth, persistence, sync, relay, policy

apps/free/app
  rendering shell only
```

Notes:

- `packages/runtime` may begin life inside `apps/free/cli` and be extracted later
- `packages/core` must avoid drifting into runtime implementation details
- `apps/free/app` should eventually depend on presentation facades only

## 11. Enforced Boundaries

The following dependencies should be considered violations in the target architecture:

- app screen importing runtime internals directly
- app importing encryption, socket, persistence, or sync orchestration directly
- server code branching on vendor agent kind for core business logic
- server storing vendor-native wire payloads as product truth
- runtime leaking vendor-native event formats above the driver boundary
- UI components importing state mutation logic with hidden side effects

## 12. Testing Strategy Implications

This architecture exists to improve testability.

Expected test distribution:

- UI tests: rendering and interaction mapping only
- presentation tests: view-model shaping from canonical state
- application tests: use case behavior with fake runtime/server boundaries
- runtime tests: orchestration, switching, invocation, capability routing
- driver tests: vendor dialect translation
- server tests: auth, persistence, replay, relay, policy

The majority of business behavior should be testable without React, sockets, or real child processes.

## 13. Migration Guidance

The repository does not need a full rewrite. Migration should proceed by forcing the new boundaries.

Recommended order:

1. make app a rendering shell
2. define canonical protocol types explicitly
3. collect agent-specific behavior behind runtime driver interfaces
4. move orchestration out of app and into runtime/application services
5. strip vendor-specific branching from server routes and storage semantics
6. introduce canonical session snapshot and invocation models

## 14. Open Questions

- Which subset of canonical snapshot is required for the first usable `switchAgent()`?
- Which agent-to-agent invocation mode ships first: capability invocation or collaborative participation?
- Does runtime live permanently in `apps/free/cli`, or graduate into `packages/runtime` once the protocol stabilizes?
- Which parts of current `packages/core` belong to canonical protocol versus runtime implementation?

## 15. Decision

This RFC establishes the desired system boundary:

- App is a shell
- Server is neutral
- Runtime owns vendor complexity
- Session is Free-owned
- Agent-to-agent invocation is a first-class runtime capability

All future architectural work should be judged against these rules.
