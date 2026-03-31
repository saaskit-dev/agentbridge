# Runtime Architecture

- **Status**: Proposed
- **Created**: 2026-03-30

This document defines the internal shape of the daemon runtime.
It is the parent architecture for future protocol, migration, and implementation documents.

Related documents:

- `006-primary-binding.md`
- `010-acpx-flow-sdk-integration.md`
- `011-truth-and-projections.md`
- `012-phase-1-plan.md`

## 1. Purpose

The daemon runtime is the primary complexity container of the system.
It must absorb ACP-specific execution differences without leaking them upward into:

- `UI / Client Shell（界面/客户端壳层）`
- `Server（服务端层）`
- `Product Semantics（产品语义层）`

The runtime should not reimplement generic ACP session/runtime mechanics that are already available in `acpx flow sdk（acpx 流程 SDK）`.

The runtime is therefore designed as four cooperating internal layers.

## 2. Runtime internal layers

### 2.1 `Runtime Orchestration（运行时编排层）`

This is the runtime decision layer.
It owns:

- `Session（会话）` execution lifecycle
- `Task（任务）` and `Invocation（调用）` coordination
- input routing
- capability gating
- policy enforcement
- failure translation
- canonical runtime outcome emission

It decides what should happen in Free semantics.
It must not directly own vendor transport details.

### 2.2 `Primary Binding（主绑定层）`

This is the bridge between a Free `Session（会话）` and a concrete execution instance.
It owns:

- which `Primary Agent（主智能体）` is currently bound to a session
- binding status
- ACP execution references
- effective capability snapshots for the active execution
- binding-scoped runtime facts

Every session has one `Primary Binding（主绑定）` for user-facing control and conversation.

It answers: which primary execution is currently attached to this Free session.

### 2.3 `Flow Runtime Bridge（Flow 运行时桥接层）`

This is the `acpx flow sdk` integration boundary owned by Free.
It owns:

- creating or resuming the product-facing main `flow run（流程运行）`
- mapping `acpx` flow and session identities into runtime-consumable facts
- exposing ACP execution references derived from `FlowSessionBinding（流程会话绑定）`
- translating `acpx flow sdk` lifecycle and capability results into runtime-facing signals

It answers: how Free talks to ACP execution through `acpx flow sdk`.
It must not own Free product semantics.

### 2.4 `Runtime State / Stream Model（运行时状态/流模型层）`

This is the runtime-internal fact model.
It owns:

- binding state
- execution activity state
- turn lifecycle state
- capability state
- resume and recovery outcomes
- failure facts
- output flow facts

It answers: what execution reality is currently happening inside the runtime,
before those facts are projected outward.

## 3. Cooperation model

The runtime layers should cooperate through the following flow:

```text
Command / trigger
  -> Runtime Orchestration
  -> lookup/create/update Primary Binding
  -> Primary Binding uses Flow Runtime Bridge
  -> Flow Runtime Bridge talks to acpx Flow SDK
  -> acpx Flow SDK drives ACP execution
  -> Flow Runtime Bridge yields execution feedback
  -> Primary Binding records runtime facts
  -> Runtime Orchestration interprets those facts
  -> canonical outcomes are emitted upward
```

Key rule:

- `Runtime Orchestration（运行时编排层）` decides
- `Primary Binding（主绑定层）` holds execution reality
- `Flow Runtime Bridge（Flow 运行时桥接层）` connects runtime semantics to `acpx flow sdk（acpx 流程 SDK）`
- `Runtime State / Stream Model（运行时状态/流模型层）` carries internal facts

## 4. Boundary rules

### 4.1 `Runtime Orchestration（运行时编排层）` must not own

- vendor SDK or ACP transport details
- PTY byte handling
- raw process management details
- UI-facing payload shaping
- direct server socket mechanics

### 4.2 `Primary Binding（主绑定层）` must not own

- product-level policy decisions
- invocation policy
- task semantics
- server persistence decisions

### 4.3 `Flow Runtime Bridge（Flow 运行时桥接层）` must not own

- `Session（会话）` product semantics
- `Invocation（调用）` semantics
- server sync or IPC broadcasting
- UI-facing message formats as a final contract
- policy enforcement beyond reporting `acpx flow sdk` constraints

### 4.4 `Runtime State / Stream Model（运行时状态/流模型层）` must not become

- the UI presentation model
- the server persistence schema
- raw vendor payload passthrough
- a synonym for `NormalizedMessage（规范消息）`

## 5. Resume and recovery

`resume（恢复）` is a cross-layer runtime capability.
It must not be treated as a concern of only one layer.

### 5.1 `Runtime Orchestration（运行时编排层）`

Owns:

- whether recovery should be attempted
- whether degraded recovery is acceptable
- how recovery results affect product semantics

### 5.2 `Primary Binding（主绑定层）`

Owns:

- recoverable binding state
- binding status updates during recovery
- carrying the current vendor execution reference used for recovery

### 5.3 `Flow Runtime Bridge（Flow 运行时桥接层）`

Owns:

- asking `acpx flow sdk（acpx 流程 SDK）` to perform ACP-specific recovery attempts
- reporting whether recovery succeeded, failed, is unsupported, or requires rebuild-from-context

### 5.4 `Runtime State / Stream Model（运行时状态/流模型层）`

Must explicitly represent recovery results.
A recovery outcome should never be implicit.

Example categories:

- `native_resume`
- `rebuild_from_context`
- `unsupported`
- `failed`

## 6. First-phase constrained implementation

The target architecture is broader than the current runtime capabilities.
The first implementation phase should therefore be explicitly constrained rather than pretending the final capability set already exists.

### 6.1 Phase-1 guarantees

Phase 1 should support:

- a Free `Session（会话）` as the product context
- exactly one active `Primary Binding（主绑定）` per session at a time
- exactly one active agent execution per session at a time
- explicit capability reporting for unsupported advanced behavior
- explicit recovery outcomes

### 6.2 Phase-1 limitations

Phase 1 may legitimately not support:

- lossless agent switching inside one session
- nested or parallel `Invocation（调用）`
- multi-binding execution
- advanced ACP-independent recovery

### 6.3 Architectural rule for phased delivery

The runtime may be capability-constrained, but the semantics must not be absent.

This means:

- advanced concepts still exist in the model
- unsupported behavior is reported explicitly
- temporary implementation limits are expressed as constrained capability, not as missing architecture

## 7. Relationship to current code

This architecture maps onto the current repository as follows:

- `apps/free/cli/src/daemon/sessions/*` currently mixes orchestration and binding concerns
- `apps/free/cli/src/backends/*` is transitional code that should shrink as `acpx flow sdk（acpx 流程 SDK）` becomes the sole execution substrate
- `apps/free/cli/src/agent/*` appears to be a transitional or overlapping abstraction layer
- `NormalizedMessage（规范消息）` is currently a shared cross-layer payload, but should be treated as an outward projection rather than the sole runtime truth

## 8. Preferred ACP execution substrate

The preferred and intended ACP execution substrate is:

- `acpx flow sdk（acpx 流程 SDK）`

This means:

- Free should stop growing a separate per-agent ACP adapter hierarchy
- Free should keep a thin `Flow Runtime Bridge（Flow 运行时桥接层）` for product/runtime integration
- Free should not maintain a second non-flow ACP execution path in parallel

The preferred integration mode is:

- process-boundary integration with `acpx`, while treating `flow sdk` as the only product-facing execution entry

Not:

- in-process deep import of `acpx/dist/*` runtime internals
- dual execution integration paths for the same product runtime

## 9. Current completion rule

The current implementation has one verified turn-end signal and one verified sync-settled boundary:

- ACP turn end signal: `ready`
- upstream sync-settled boundary: `ApiSessionClient.flush()`

So the current implementation-level completion rule is:

- `done = ready + flush completed`

This is a grounded statement about the current daemon runtime.
It is not yet the final cross-runtime product contract.

The goal is to evolve the current daemon into this layered runtime shape incrementally.

## 10. Evaluation rule

Any future runtime proposal should be evaluated against the following question:

- does it strengthen the four-layer runtime structure while keeping `acpx flow sdk` as the only ACP execution entry,
- or does it reintroduce parallel ACP paths and duplicated runtime mechanics?

## Further reading

- `001-overview.md`
- `002-principles.md`
- `003-entity-model.md`
- `004-current-runtime-analysis.md`
