# acpx Sidecar Integration

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines how `agentbridge` should integrate `acpx sidecar（acpx 侧车）` into the target runtime architecture.

## 1. Decision

`agentbridge` should adopt `acpx sidecar（acpx 侧车）` as the preferred ACP execution substrate.

This means:

- stop growing a separate in-repo per-agent ACP runtime stack
- keep agentbridge-specific product/runtime supervision in the daemon
- bridge to `acpx` over a stable sidecar boundary

## 2. Why

`acpx` already implements most of the hard ACP mechanics that overlap with agentbridge needs:

- ACP session lifecycle
- `session/new`
- `session/load`
- reconnect and resume behavior
- queueing and cancel
- mode/model/config controls
- ACP event and conversation persistence
- explicit separation of local record identity and ACP session identity

Rebuilding these mechanics inside agentbridge would duplicate a moving ACP runtime.

## 3. What `acpx` replaces

`acpx sidecar（acpx 侧车）` should replace most of agentbridge's custom ACP-specific execution layer, including:

- per-agent ACP transport logic
- per-agent ACP session creation/load logic
- per-agent reconnect/resume logic
- per-agent queueing/cancel/mode/model control logic

This especially impacts the long-term role of:

- `apps/free/cli/src/backends/*`
- `apps/free/cli/src/agent/*`
- ACP-specific parts of `packages/core/src/implementations/agent/*`

## 4. What agentbridge keeps

Even with `acpx sidecar（acpx 侧车）`, agentbridge must still keep:

- product `Session（会话）` semantics
- `Primary Agent（主智能体）`
- `Primary Binding（主绑定）`
- `AgentSession（会话执行协调器）` or its future orchestration replacement
- `daemon -> server` synchronization
- user-visible progress and completion semantics
- app/server-facing canonical state and entities

In short:

- `acpx` owns ACP execution mechanics
- agentbridge owns product/runtime supervision

## 5. Preferred integration mode

The preferred integration mode is:

- `agentbridge daemon runtime`
- `ACP Bridge（ACP 桥接层）`
- `acpx sidecar（acpx 侧车）`
- ACP execution

This should be treated as:

- a sidecar or subprocess boundary
- not a deep in-process dependency on `acpx` internals

## 6. Why sidecar instead of deep import

`acpx` is currently:

- alpha
- primarily a CLI product
- only clearly exporting CLI entrypoints and `./flows`

It does not currently present a clearly stable embedded runtime API for another product daemon.

So the lower-risk choice is:

- integrate with `acpx` as an external runtime component

and avoid:

- deep-importing `acpx/dist/*` runtime internals as if they were stable SDK contracts

## 7. Runtime shape after adoption

After adoption, the daemon runtime should look like:

- `Runtime Orchestration（运行时编排层）`
- `Primary Binding（主绑定层）`
- `ACP Bridge（ACP 桥接层）`
- `Runtime State / Stream Model（运行时状态/流模型层）`
- external `acpx sidecar（acpx 侧车）`

The key change is:

- `ACP Bridge（ACP 桥接层）` becomes thin
- `acpx` becomes the primary ACP session/runtime engine

## 8. Identity mapping

When `acpx` is used, the ACP-side execution identity should prefer `acpx`'s explicit identity model:

- `acpxRecordId`
- `acpxSessionId`
- optional `agentSessionId`

These should feed into `Primary Binding（主绑定）` rather than being collapsed into the product `Session（会话）` identity.

## 9. Current adoption scope

Phase 1 should treat this as an architectural direction, not a full migration requirement.

Phase 1 can legitimately:

- keep current runtime flow and semantics
- preserve `done = ready + flush completed`
- defer complete replacement of in-repo ACP code

But new runtime design should assume `acpx sidecar（acpx 侧车）` is the long-term ACP execution substrate.

## 10. Deferred follow-up

This document does not decide whether `acpx/flows` should later become the default multi-agent orchestration layer.

That remains a later architectural decision.
