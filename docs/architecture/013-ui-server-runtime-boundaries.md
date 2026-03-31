# UI / Server / Runtime Boundaries

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines the boundary between:

- `UI / Client Shell（界面/客户端壳层）`
- `Server（服务端层）`
- `Daemon Runtime（守护进程运行时）`

It intentionally focuses on responsibilities and allowed information flow.
It does not attempt to finalize a low-level wire protocol yet.

## 1. Purpose

The system is only maintainable if each layer has a narrow and explicit job.

This document exists to prevent three common failure modes:

- UI absorbing runtime and sync logic
- Server absorbing ACP-specific execution semantics
- Runtime leaking raw ACP execution details upward as if they were product truth

## 2. Boundary summary

## 2.1 `UI / Client Shell（界面/客户端壳层）`

UI should own:

- rendering
- user input
- view composition
- local presentation state

UI should not own:

- ACP execution control
- recovery policy
- sync retry policy
- authoritative completion semantics
- execution truth reconstruction from raw ACP events

## 2.2 `Server（服务端层）`

Server should own:

- auth
- persistence
- relay
- synchronization
- coordination across clients and daemon connections

Server should not own:

- ACP session/runtime mechanics
- ACP event interpretation
- primary execution orchestration
- per-turn execution completion inference from raw ACP behavior

## 2.3 `Daemon Runtime（守护进程运行时）`

Runtime should own:

- execution supervision
- `Primary Binding（主绑定）`
- interaction with `acpx flow sdk（acpx 流程 SDK）` through `Flow Runtime Bridge（Flow 运行时桥接层）`
- turn coordination
- recovery decisions
- execution-side and sync-side completion composition
- runtime fact production

Runtime should not own:

- broad UI presentation policy
- server persistence policy beyond producing canonical facts and projections
- long-lived app-specific view models

## 3. Canonical flow between layers

The intended high-level flow is:

```text
UI
  -> sends canonical commands
Server
  -> validates and persists product records
  -> relays runtime-facing commands
Daemon Runtime
  -> supervises execution
  -> produces authoritative runtime facts and derived projections
Server
  -> persists authoritative records and relays projections
UI
  -> renders canonical records and projections
```

The key rule is:

- UI sends intent
- Runtime determines execution semantics
- Server persists and relays

## 4. What each layer should consume

## 4.1 UI should consume

UI should primarily consume:

- `Session（会话）`
- `Message（消息）`
- `Artifact（产物）`
- `MessageProgress（消息进度）`
- `SessionProgress（会话进度）`
- optional runtime-derived detail projections

UI may consume detailed execution views when the user asks for detail.
It should not need to consume raw ACP wire events directly.

## 4.2 Server should consume

Server should consume and persist:

- `Session`
- `Message`
- `Primary Binding`
- `ExecutionEvent（执行事件）`
- `Artifact`

Server may also cache or materialize:

- `MessageProgress`
- `SessionProgress`
- timeline or flow projections

But those should remain derived, not become the new primary truth.

## 4.3 Runtime should consume

Runtime should consume:

- canonical commands from app/server-facing layers
- current session and binding state
- ACP execution feedback from `acpx flow sdk`
- sync-side facts from `ApiSessionClient（会话同步客户端）`

Runtime should combine those into:

- authoritative runtime facts
- canonical product updates
- derived projections for UI/server use

## 5. What UI must never infer by itself

UI must not independently infer:

- whether ACP execution is complete
- whether sync has settled
- whether recovery succeeded
- whether a user-visible message is `done`

Those semantics belong to runtime.

UI may choose how to present them.
UI must not redefine them.

## 6. What Server must never infer by itself

Server must not independently infer from incomplete runtime data:

- that an ACP turn is finished
- that a message is completed before runtime signals it
- that ACP-specific failures map directly to product failure

Server should trust runtime-produced facts and projections for execution semantics.

## 7. What Runtime must preserve for upper layers

Runtime must preserve enough information for upper layers to support both:

- simple default UX
- optional expanded execution detail

This means runtime must keep:

- authoritative execution facts
- explicit completion semantics
- sufficient projection inputs

It must not collapse everything into a single opaque transport envelope.

## 8. Relationship to `acpx flow sdk`

The boundary to ACP execution should be:

- `Daemon Runtime`
- `Flow Runtime Bridge（Flow 运行时桥接层）`
- `acpx flow sdk（acpx 流程 SDK）`

Not:

- `UI -> acpx`
- `Server -> acpx`
- `UI -> raw ACP`

This keeps ACP execution reusable and keeps product semantics inside Free.

## 9. First-phase application

In Phase 1, these boundaries should be applied conservatively.

This means:

- keep current UI behavior if necessary
- keep current server sync shape if necessary
- improve the daemon runtime boundary first

The first architectural priority is not a new UI protocol.
The first priority is a cleaner runtime that can later support a better UI and server contract.

## 10. Summary

The target boundary is simple:

- UI renders and collects intent
- Server persists and relays
- Runtime supervises execution and defines execution truth

That separation is the foundation for the rest of the refactor.
