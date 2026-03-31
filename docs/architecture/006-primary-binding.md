# Primary Binding

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines `Primary Binding（主绑定）` for the current and future daemon runtime.

## 1. Definition

`Primary Binding（主绑定）` is the runtime-owned binding between a Free `Session（会话）` and the primary execution currently responsible for user-facing conversation and control.

It is the answer to:

- which primary execution is currently attached to this session
- which `acpx flow sdk（acpx 流程 SDK）` execution identity is active
- what the current binding status is
- what effective capabilities are available on this active execution

## 2. What it is not

`Primary Binding（主绑定）` is not:

- the `Session（会话）` itself
- the `Primary Agent（主智能体）` itself
- `AgentSession（会话执行协调器）`
- `ApiSessionClient（会话同步客户端）`
- a UI model
- a server persistence schema for all runtime behavior

It should stay narrow.

## 3. Why it exists

The current codebase already separates:

- Free session identity
- ACP execution identity

But that separation is implicit and distributed.

Without an explicit `Primary Binding（主绑定）`, the codebase keeps mixing:

- session semantics
- execution ownership
- ACP recovery references
- upstream sync concerns

The main purpose of `Primary Binding（主绑定）` is to make this boundary explicit.

## 4. Current reality

Today, `Primary Binding（主绑定）` exists only implicitly across:

- `AgentSession（会话执行协调器）`
- the active flow-facing execution path
- ACP resume or session reference state
- selected execution status fields

So the concept is already real.
What is missing is an explicit model and boundary.

## 5. Minimal fields

The minimal runtime-facing shape should be:

```ts
type PrimaryBinding = {
  sessionId: string;
  agentId: string;

  status: 'binding' | 'active' | 'paused' | 'detached' | 'failed';

  acpSessionRef: string | null;
  effectiveCapabilities: unknown | null;

  lastReadyAt: number | null;
  lastActivityAt: number | null;
};
```

## 6. Field meaning

### `sessionId`

The Free `Session（会话）` this binding belongs to.

### `agentId`

The current `Primary Agent（主智能体）` attached to this session.

### `status`

The current binding state.

- `binding`: binding is being established
- `active`: primary ACP execution is attached and usable
- `paused`: execution is temporarily paused
- `detached`: the session exists but no primary execution is currently attached
- `failed`: the binding has entered an unrecoverable runtime failure state

### `acpSessionRef`

The ACP-side execution reference used for:

- continued execution
- recovery
- ACP-side identity correlation

This must not be treated as the product session identity.

Because Free now targets `acpx flow sdk（acpx 流程 SDK）` as its sole execution substrate, this reference should prefer `acpx`'s explicit identity model over an opaque ad-hoc string:

- `acpxRecordId`
- `acpxSessionId`
- optional `agentSessionId`

### `effectiveCapabilities`

The capabilities actually available on the active primary execution.
This is narrower and more dynamic than agent-level theoretical capability.

### `lastReadyAt` and `lastActivityAt`

Execution activity markers useful for:

- turn completion tracking
- recovery decisions
- observability

## 7. Minimal behaviors

Even in a constrained first phase, `Primary Binding（主绑定）` needs to support these behaviors:

- attach to a chosen primary ACP execution
- expose current ACP execution reference
- report binding status changes
- expose effective capability state
- record last activity and last turn-ready time

It does not need to own:

- turn scheduling
- output forwarding
- upstream sync
- task or invocation semantics

## 8. Boundaries

### Belongs to `Primary Binding（主绑定）`

- current session-to-primary-execution association
- ACP execution reference
- binding status
- effective capability snapshot for the current primary execution
- execution activity markers

### Does not belong to `Primary Binding（主绑定）`

- queueing user input
- deciding when a turn starts
- deciding when a turn is complete for product semantics
- outbox ownership
- `flush()` semantics
- UI projection
- product session metadata such as title or archive state

## 9. Relationship to other runtime objects

### `AgentSession（会话执行协调器）`

`AgentSession` should evolve toward a `Runtime Orchestration Host（运行时编排宿主）`.
It should use `Primary Binding（主绑定）`, not be confused with it.

### `Flow Runtime Bridge（Flow 运行时桥接层）`

The flow runtime bridge connects Free runtime semantics to `acpx flow sdk（acpx 流程 SDK）`.
`Primary Binding（主绑定）` carries the current relationship to the active execution exposed through that bridge.

### `ApiSessionClient（会话同步客户端）`

`ApiSessionClient` is the upstream sync channel.
It is not part of `Primary Binding（主绑定）`, but it provides sync-side facts that orchestration combines with binding-side facts.

## 10. First-phase constraints

Phase 1 should keep this intentionally narrow:

- one session has exactly one active `Primary Binding（主绑定）`
- the binding points to one primary ACP execution
- no parallel primary bindings
- no attempt to model invocation-specific sub-bindings yet

This is a constrained implementation, not a permanent semantic limit.

## 11. Migration intent

The point of this document is not to create a speculative new object.
It is to extract an already-existing runtime boundary from the current implicit structure.

The migration direction is:

- make the implicit primary binding explicit
- reduce `AgentSession（会话执行协调器）` back toward orchestration
- keep ACP execution references out of the product `Session（会话）`
