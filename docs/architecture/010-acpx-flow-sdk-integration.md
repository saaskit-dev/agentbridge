# acpx Flow SDK Integration

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines how Free should integrate `acpx flow sdk（acpx 流程 SDK）` into the target runtime architecture.

## 1. Decision

Free should adopt `acpx flow sdk（acpx 流程 SDK）` as the sole ACP execution substrate.

This means:

- stop growing a separate in-repo per-agent ACP runtime stack
- stop planning a second direct ACP execution path beside flows
- keep Free-specific product/runtime supervision in the daemon
- bridge to `acpx` through a stable Free-owned boundary

## 2. Why

`acpx` already implements most of the hard ACP mechanics that overlap with Free's needs:

- ACP session lifecycle
- `session/new`
- `session/load`
- reconnect and resume behavior
- queueing and cancel
- mode/model/config controls
- ACP event and conversation persistence
- explicit separation of local record identity and ACP session identity
- a `flow sdk` with one main ACP session by default, optional isolated side sessions, liveness, recovery, and replay bundles

Rebuilding these mechanics inside Free would duplicate a moving ACP runtime.

## 3. What `acpx` replaces

`acpx flow sdk（acpx 流程 SDK）` should replace most of Free's custom ACP-specific execution layer, including:

- per-agent ACP transport logic
- per-agent ACP session creation/load logic
- per-agent reconnect/resume logic
- per-agent queueing/cancel/mode/model control logic
- any future attempt to keep both flow-based and non-flow ACP execution paths alive

This especially impacts the long-term role of:

- `apps/free/cli/src/backends/*`
- `apps/free/cli/src/agent/*`
- ACP-specific parts of `packages/core/src/implementations/agent/*`

## 4. What Free keeps

Even with `acpx flow sdk（acpx 流程 SDK）`, Free must still keep:

- product `Session（会话）` semantics
- `Primary Agent（主智能体）`
- `Primary Binding（主绑定）`
- `AgentSession（会话执行协调器）` or its future orchestration replacement
- `daemon -> server` synchronization
- user-visible progress and completion semantics
- app/server-facing canonical state and entities

In short:

- `acpx flow sdk` owns ACP execution mechanics
- Free owns product/runtime supervision

## 5. Preferred integration mode

The preferred integration mode is:

- `Free daemon runtime`
- `Flow Runtime Bridge（Flow 运行时桥接层）`
- `acpx flow sdk`
- ACP execution

This should be treated as:

- one execution substrate
- one product supervision layer
- no second parallel ACP runtime path

## 6. Stability and coupling note

`acpx` is currently:

- alpha
- primarily a CLI product
- only clearly exporting CLI entrypoints and `./flows`

It does not currently present a clearly stable embedded runtime API for another product daemon.

So the architecture must assume:

- `acpx flow sdk` is an external dependency that may still evolve
- Free must keep a thin bridge and product/runtime boundary around it
- Free must not collapse product session semantics into raw `flow run` semantics

## 7. Runtime shape after adoption

After adoption, the daemon runtime should look like:

- `Runtime Orchestration（运行时编排层）`
- `Primary Binding（主绑定层）`
- `Flow Runtime Bridge（Flow 运行时桥接层）`
- `Runtime State / Stream Model（运行时状态/流模型层）`
- external `acpx flow sdk（acpx 流程 SDK）`

The key change is:

- `Flow Runtime Bridge（Flow 运行时桥接层）` becomes thin
- `acpx flow sdk` becomes the only ACP session/runtime engine

## 8. Identity mapping

When `acpx flow sdk` is used, the ACP-side execution identity should prefer `acpx`'s explicit identity model:

- `acpxRecordId`
- `acpxSessionId`
- optional `agentSessionId`

These should feed into `Primary Binding（主绑定）` rather than being collapsed into the product `Session（会话）` identity.

## 9. Current adoption scope

Phase 1 should treat this as an architectural direction, not a full migration requirement.

Phase 1 can legitimately:

- keep current runtime flow and semantics where necessary
- preserve `done = ready + flush completed`
- move design and new work toward a single flow-sdk-based execution path

But new runtime design should assume `acpx flow sdk（acpx 流程 SDK）` is the long-term and sole ACP execution substrate.

## 10. Deferred follow-up

This document does not claim that `flow run（流程运行）` is identical to product `Session（会话）`.

That lifecycle mapping remains a Free-owned product/runtime decision.
