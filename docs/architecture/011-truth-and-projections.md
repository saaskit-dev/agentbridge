# Truth and Projections

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines:

- which runtime and product records are treated as `source of truth（真相来源）`
- which user-facing and sync-facing models are treated as `derived projections（派生投影）`
- which cached views are acceptable as optimization, but not as authority

The goal is simple:

- keep the write model small
- keep authoritative semantics explicit
- avoid parallel state machines that drift out of sync

## 1. Why this document exists

The current system already mixes:

- product entities
- runtime facts
- transport envelopes
- user-facing progress and status

Without an explicit rule for truth vs projection, later implementation will tend to:

- manually maintain too many status fields
- duplicate completion state across daemon, server, and UI
- make `NormalizedMessage（规范消息）` act as a universal state carrier

This document prevents that.

## 2. Rule of thumb

If a user-visible state can be reconstructed from a smaller authoritative set, it should not become its own independently maintained source of truth.

In practice:

- write a small number of authoritative records
- append runtime facts
- derive user-facing progress and views from those records

## 3. Sources of truth

## 3.1 `Session（会话）`

`Session` remains an authoritative product record.

It answers:

- what the working context is
- who the `Primary Agent（主智能体）` is
- what session-level policy exists

It does not answer:

- how ACP execution is currently attached
- whether the current turn has finished

## 3.2 `Message（消息）`

`Message` remains an authoritative product record.

It answers:

- what the user or agent said
- what content belongs to the conversation timeline

It does not answer:

- whether execution is still in progress
- whether upstream sync has settled

## 3.3 `Primary Binding（主绑定）`

`Primary Binding` is an authoritative runtime record.

It answers:

- which primary execution is currently attached to the session
- what ACP-side identity is currently in play
- what the binding status is
- what the effective capability surface is for the active execution

It does not answer:

- the full conversation history
- the full delivery status of every user message

## 3.4 `ExecutionEvent（执行事件）`

`ExecutionEvent` is the authoritative runtime fact log.

It should capture durable runtime facts such as:

- message accepted into execution
- turn started
- ACP prompt sent
- tool started / updated / completed
- `ready`
- sync started / settled / failed
- recovery started / completed / failed
- execution failed / cancelled

`ExecutionEvent` is the key reason we do not need to co-maintain many separate status models.

## 3.5 `Artifact（产物）`

`Artifact` remains an authoritative product/runtime output record.

It answers:

- what reusable output was produced
- what file, patch, image, or structured result exists

## 3.6 Future authoritative entities

When they become active scope, these should also be treated as truth:

- `Task（任务）`
- `Invocation（调用）`

But they are not required to become first-phase implementation dependencies.

## 4. Derived projections

## 4.1 `MessageProgress（消息进度）`

`MessageProgress` should be treated as a derived projection.

Its first-phase job is to answer:

- has this message entered execution
- is it currently running
- has ACP reached `ready`
- has sync settled
- did it fail

It should be derived from:

- `Message`
- `ExecutionEvent`
- `Primary Binding`

It should not be the first state model that engineers are asked to manually update in parallel.

## 4.2 `SessionProgress（会话进度）`

`SessionProgress` should be treated as a derived projection.

It should summarize:

- whether the session currently has active work
- whether the primary execution is running, recovering, syncing, or failed

It should be derived from:

- `Primary Binding`
- recent `ExecutionEvent`
- unresolved active turn state

## 4.3 UI-facing flow views

UI-facing views such as:

- `Primary Flow View（主流程视图）`
- `Detailed Event View（详细事件视图）`

should both be treated as projections.

They may be:

- computed in the daemon
- cached on the server
- reconstructed by a query layer

But they should not become new primary truth records.

## 4.4 Current execution snapshots

Execution snapshots such as:

- current turn state
- current binding activity
- current blocking reason

may be cached for responsiveness, but should still be conceptually derived from:

- current binding state
- recent `ExecutionEvent`

## 5. Cached truth-like records

Some records are acceptable as cached or denormalized materializations, as long as their status is explicit.

## 5.1 Capability snapshots

`CapabilitySnapshot（能力快照）` is allowed as a cached runtime-facing record.

Reason:

- it is read frequently
- it is needed by runtime and UI
- recomputing it from ACP/acpx facts every time is wasteful

But it still conceptually derives from:

- ACP/acpx capability facts
- runtime normalization
- current `Primary Binding`

## 5.2 Conversation or timeline views

Any assembled timeline record is a projection, not truth.

This matters because the system should be able to rebuild conversation and progress views from authoritative records.

## 6. What should not become separate truth

The following should not become independently maintained primary truth unless proven necessary:

- `MessageProgress`
- `SessionProgress`
- UI-specific grouped timeline sections
- user-visible step labels
- per-turn display summaries
- duplicated delivery state in both daemon and server as separate primary models

## 7. First-phase storage guidance

The first phase should keep the write model intentionally small.

The preferred authoritative set is:

- `Session`
- `Message`
- `Primary Binding`
- `ExecutionEvent`
- `Artifact`

The preferred projection set is:

- `MessageProgress`
- `SessionProgress`
- UI-facing flow views
- timeline summaries

## 8. Relationship to current implementation

Today, `NormalizedMessage（规范消息）` still carries some mixed semantics across layers.

This document does not require removing it immediately.

Instead, it establishes the direction:

- `NormalizedMessage` should not be treated as the universal source of truth
- runtime facts should become more explicit
- user-facing progress should be derived from explicit facts, not inferred ad hoc from message envelopes

## 9. Implementation consequence

When adding new status or view behavior, the first question must be:

- is this a new authoritative fact
- or is this a new projection of existing truth

If the answer is projection, it should be implemented as:

- a derived runtime view
- a server-side projection
- or a UI-side presentation model

not as a new primary state source.

## 10. Summary

The architecture should prefer:

- few authoritative records
- append-only execution facts
- reconstructable progress and views

This keeps the system:

- easier to reason about
- easier to debug
- less likely to drift across daemon, server, and UI
