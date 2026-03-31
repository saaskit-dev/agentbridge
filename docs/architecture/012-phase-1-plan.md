# Phase 1 Plan

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines the first implementation phase for the Free runtime architecture.

It is intentionally narrow.
The purpose of Phase 1 is not to deliver the full final architecture.
The purpose is to create a stable runtime core that future capabilities can build on.

## 1. Phase-1 objective

Phase 1 should establish a clean runtime core for the current grounded model:

- one `Session（会话）`
- one `Primary Agent（主智能体）`
- one active `Primary Binding（主绑定）`
- one user-facing execution chain backed by `acpx flow sdk（acpx 流程 SDK）`
- one grounded completion rule:
  - `done = ready + flush completed`

Phase 1 should reduce ambiguity in runtime ownership and runtime boundaries.

Phase 1 should also establish a testing-first implementation path:

- runtime-first implementation order
- unit-testable flow boundaries
- integration-test coverage for every critical execution flow

## 2. What Phase 1 must accomplish

## 2.1 Make the daemon runtime the explicit execution center

The daemon runtime must be treated as the primary execution kernel.

This means:

- execution truth is no longer mentally anchored in app state
- execution truth is no longer mentally anchored in server relay behavior
- runtime facts are grounded in daemon behavior and `acpx flow sdk（acpx 流程 SDK）` interaction

## 2.2 Establish `Primary Binding（主绑定）` as an explicit boundary

Phase 1 should make the binding boundary explicit in architecture and code structure.

It does not require a full new product model first.
It does require that the system stop treating current execution attachment as an unnamed implicit bundle.

## 2.3 Keep `AgentSession（会话执行协调器）` as the first orchestration host

Phase 1 should not attempt to delete or replace `AgentSession` wholesale.

Instead it should:

- acknowledge `AgentSession` as the current `Runtime Orchestration Host（运行时编排宿主）`
- gradually separate binding concerns from it
- gradually separate projection concerns from it

## 2.4 Adopt `acpx flow sdk` as the sole ACP execution substrate

Phase 1 should stop expanding in-repo per-agent ACP runtime logic.

Instead it should move toward:

- `Free runtime`
- thin `Flow Runtime Bridge（Flow 运行时桥接层）`
- `acpx flow sdk`
- ACP execution

## 2.5 Ground user-visible completion in current verified signals

Phase 1 should use the current grounded completion semantics:

- execution-side completion signal: `ready`
- sync-side completion signal: `flush()`

It should not invent a more abstract completion rule before the runtime core is stabilized.

## 2.6 Make critical flows testable without the product UI

Phase 1 should ensure that critical runtime behavior can be validated by automated tests rather than only by manual product walkthroughs.

This means:

- each important execution flow should have a runtime-level testable seam
- completion semantics should be asserted in tests
- failure and recovery transitions should be asserted in tests
- app-driven manual verification should become a secondary check, not the primary proof

## 3. What Phase 1 should not attempt

Phase 1 should explicitly avoid:

- full multi-agent orchestration
- full `Invocation（调用）` execution
- lossless `switchAgent（切换智能体）`
- broad UI redesign
- broad server protocol redesign
- removing `NormalizedMessage（规范消息）` immediately
- replacing the product runtime with raw `flow run` semantics

These are later-phase goals.

## 4. Recommended implementation sequence

## 4.1 Step 1: make runtime boundaries explicit in code structure

The first implementation step should focus on daemon runtime internals.

Primary goal:

- reduce ambiguity between orchestration, binding, ACP execution, and sync responsibilities

Test requirement:

- add or preserve runtime-local seams so these boundaries can be unit tested

## 4.2 Step 2: introduce an explicit binding-oriented runtime model

This may begin as:

- an extracted internal type
- an extracted helper boundary
- or a dedicated runtime record

The first representation does not need to be final.
What matters is making the boundary real.

Test requirement:

- binding state transitions must be assertable without going through the full product app

## 4.3 Step 3: keep sync completion separate from execution completion

The runtime should continue treating:

- `ready`
- `flush()`

as different signals owned by different subsystems.

This is necessary to preserve the grounded dual-sided completion rule.

Test requirement:

- `ready`
- `flush()`
- `done = ready + flush completed`

must be covered by deterministic integration tests.

## 4.4 Step 4: introduce minimal derived progress

If a first progress model is added, it should be:

- minimal
- runtime-derived
- based on authoritative facts

It should not begin as a large independently persisted state machine.

Test requirement:

- progress derivation should be verified from authoritative facts
- progress should not require manual UI inspection to validate correctness

## 4.5 Step 5: only then widen external projections

Once runtime facts and boundaries are stable, later work can decide:

- what to sync to server
- what to expose to UI
- what to keep daemon-local

Test requirement:

- projections exposed upward should be integration tested against runtime facts

## 5. Authoritative records and projections in Phase 1

Phase 1 should align with the truth/projection split:

### Authoritative

- `Session`
- `Message`
- `Primary Binding`
- `ExecutionEvent（执行事件）`
- `Artifact`

### Derived

- `MessageProgress（消息进度）`
- `SessionProgress（会话进度）`
- UI-facing flow views
- timeline and summary views

## 6. Phase-1 success criteria

Phase 1 should be considered successful if the following are true:

### 6.1 Runtime authority is clearer

It is obvious, in both code and docs, that:

- daemon runtime owns execution semantics
- `AgentSession` is orchestration-oriented
- `Primary Binding` is an execution-attachment concept
- `ApiSessionClient（会话同步客户端）` remains a sync-side fact source

### 6.2 ACP reuse boundary is clearer

It is obvious that:

- Free is not growing a fresh ACP runtime stack
- `acpx flow sdk` is the sole ACP execution substrate
- ACP execution is reached through a `Flow Runtime Bridge`

### 6.3 Completion semantics are clearer

It is obvious that:

- `ready` is not enough by itself
- `flush()` is not execution completion by itself
- `done = ready + flush completed`

### 6.4 Progress can be added without creating state sprawl

It is possible to add user-visible progress while keeping:

- small write models
- explicit runtime facts
- derived projections

### 6.5 Critical flows are test-locked

It is possible to verify, through automated tests, at least the following:

- primary turn acceptance
- active execution start
- ACP-side turn completion
- sync-settled completion
- terminal failure handling

The system should not depend on manual end-to-end product clicking as the primary regression guard.

## 7. Phase-1 non-goals as guardrails

The following are not failure if absent at the end of Phase 1:

- visible invocation trees
- background work visualization
- switchable primary agent within one live session
- generalized workflow engine adoption
- complete ACP-independent runtime protocol standardization

They should remain later-phase topics.

## 8. Relationship to later phases

Phase 1 is meant to unlock later work, not replace it.

Later phases can build on it for:

- explicit `Invocation`
- multi-agent orchestration
- stronger runtime projections
- UI/server/runtime protocol formalization
- explicit lifecycle mapping between product `Session（会话）` and `flow run（流程运行）`
- deeper test harnesses that cover invocation and background work flows

See also:

- `011-truth-and-projections.md`
- `013-ui-server-runtime-boundaries.md`

## 9. Summary

Phase 1 is the boundary-clarification phase.

It should:

- stabilize runtime ownership
- stabilize binding semantics
- stabilize ACP reuse boundaries
- stabilize current completion semantics
- establish runtime-first automated flow coverage

It should not attempt to finish the whole architecture in one step.
