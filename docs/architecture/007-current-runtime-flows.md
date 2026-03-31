# Current Runtime Flows

- **Status**: Grounded design summary
- **Created**: 2026-03-31

This document captures the current single-primary-agent execution flow of the daemon runtime.
It is intentionally scoped to the current implementation reality.

Future target integration with `acpx flow sdk（acpx 流程 SDK）` is described in `010-acpx-flow-sdk-integration.md`.

## 1. Scope

This document covers:

- session creation and primary agent selection
- current primary execution flow for one user message
- current completion semantics

It does not yet cover:

- multi-agent invocation
- agent switching
- advanced recovery graphs

## 2. Current top-level flow

Every current `Session（会话）` has one `Primary Agent（主智能体）`.
All user-facing execution begins there.

The current runtime flow is:

```text
Session created
-> Primary Agent chosen
-> primary execution path established (implicitly represented today)

User sends message
-> api/apiSession receives it
-> AgentSession queues and dequeues it
-> active execution path / Flow Runtime Bridge sends session/prompt
-> ACP execution emits updates
-> ready
-> ApiSessionClient.flush()
-> done or failed
```

## 3. Session creation flow

### 3.1 Primary agent choice

For the current implementation, primary agent selection follows the same user-visible agent selection model that already exists today.

The result is:

- one `Session（会话）`
- one chosen `Primary Agent（主智能体）`
- one active primary execution path

### 3.2 Primary binding establishment

In the current implementation, this is not yet an explicit first-class object.
But at runtime it still exists as the association between:

- the session
- the chosen primary agent
- the active ACP execution reference

## 4. User message flow

### 4.1 Message enters runtime

The user message is accepted by `api/apiSession`.
This is the first grounded runtime acceptance point.

This corresponds to:

- `received（已接收）`

### 4.2 Message enters orchestration

`AgentSession（会话执行协调器）` receives the turn, enqueues it, and dequeues it for backend execution.

This is the beginning of active turn handling.

### 4.3 Message enters ACP execution

The active execution path / `Flow Runtime Bridge（Flow 运行时桥接层）` emits `session/prompt` and the ACP execution begins.

ACP may then emit:

- `tool_call`
- `tool_call_update`
- `agent_message_chunk`
- `ready`

This corresponds to:

- `running（处理中）`

## 5. Current completion flow

### 5.1 ACP-side completion

The current grounded turn-end signal is:

- `ready`

This is an implementation fact of the current ACP execution path.

### 5.2 Upstream sync completion

ACP-side turn completion is not enough.
The daemon still needs to settle the upstream daemon-to-server sync path.

The current grounded sync-settled boundary is:

- `ApiSessionClient.flush()`

### 5.3 Current done rule

The current implementation-level message completion rule is:

- `done = ready + flush completed`

This is the smallest defensible completion rule for the current runtime.

## 6. Current minimal user-visible lifecycle

The current minimal user-visible lifecycle is:

- `received`
- `running`
- `syncing`
- `done`
- `failed`

Meaning:

- `received`: runtime accepted the turn into the session path
- `running`: the turn is in active ACP execution
- `syncing`: ACP emitted `ready`, but upstream sync is not yet settled
- `done`: `ready + flush completed`
- `failed`: execution-side or sync-side unrecoverable failure

## 7. Current responsibility split

### `AgentSession（会话执行协调器）`

Owns execution-side facts:

- queueing and turn dequeue
- backend send
- turn coordination
- ready handling
- execution-side failure handling

### `ApiSessionClient（会话同步客户端）`

Owns sync-side facts:

- outbox ownership
- flush and replay
- sync failure handling
- upstream session sync

### Current composition rule

User-visible completion is composed from:

- execution-side fact: `ready`
- sync-side fact: `flush completed`

## 8. Current unresolved flow questions

The current flow is already grounded, but these questions still remain open:

- whether `ready` is always the last turn-scoped persisted output
- whether a new turn can begin while the previous turn is still settling `flush()`
- whether one `flush()` failure should be treated as a final failure or a transient sync issue

These should be treated as validation items, not as already-settled protocol rules.
