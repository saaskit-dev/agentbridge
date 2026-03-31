# Glossary and Invariants

- **Status**: Working architecture glossary
- **Created**: 2026-03-31

This document fixes the core terms and hard rules used by the architecture documents.

## 1. Glossary

### `Session（会话）`

The top-level Free-owned working context.
It is not an ACP session.

### `Primary Agent（主智能体）`

The default user-facing agent chosen for a session.
User input enters the primary execution path by default.

### `Primary Binding（主绑定）`

The runtime-owned binding between a session and the currently active primary ACP execution.

### `ACP Session Ref（ACP 会话引用）`

The ACP-side execution reference used for continued execution or recovery.
It is not the product session identity.

### `AgentSession（会话执行协调器）`

The current runtime orchestration host in the daemon.
It is not the long-term name for product session semantics.

### `ACP Adapter（ACP 适配层）`

Legacy discussion term.
It should not define the current architecture.

### `ACP Bridge（ACP 桥接层）`

Legacy intermediate discussion term for the ACP-facing integration layer.
It is now superseded by `Flow Runtime Bridge（Flow 运行时桥接层）`.

### `Flow Runtime Bridge（Flow 运行时桥接层）`

The Free-owned integration layer that talks to `acpx flow sdk（acpx 流程 SDK）` and exposes execution facts to the runtime.

### `acpx Flow SDK（acpx 流程 SDK）`

The preferred and sole ACP execution substrate reused by Free instead of rebuilding ACP runtime mechanics in-repo.

### `ApiSessionClient（会话同步客户端）`

The daemon-side upstream sync channel responsible for outbox, flush, replay, and session sync with the server.

### `ready（就绪）`

The current implementation-level turn completion signal on the ACP execution side.

### `flush（同步收口）`

The current implementation-level upstream sync-settled boundary in `ApiSessionClient`.

## 2. Invariants

### 2.1 Session identity and ACP identity must remain separate

The product `Session（会话）` must not collapse back into ACP execution identity.

### 2.2 Every current session has one primary agent path

Current runtime semantics are single-primary-agent by default.
Future multi-agent behavior must extend this, not erase it.

### 2.3 `Primary Binding（主绑定）` is execution reality, not session semantics

Binding must remain narrower than product session semantics.

### 2.4 `AgentSession（会话执行协调器）` is not the product session

The current daemon host class must not be mistaken for the canonical product session model.

### 2.5 Current message completion is dual-sided

Current `done` cannot be defined from ACP-side execution alone.
It requires:

- ACP turn end: `ready`
- sync-settled boundary: `flush()`

### 2.6 Runtime must preserve enough facts for later UI choices

Runtime must keep enough execution facts such that UI can later choose:

- minimal primary display
- expanded detail display

without needing to re-invent execution truth.

### 2.7 `Attachment` must not be reused for runtime execution binding

The codebase already uses attachment terminology for file and image flows.
Runtime binding terminology must avoid that word.

### 2.8 `acpx flow sdk` is the sole ACP execution path

Free should not maintain both:

- a direct ACP runtime path
- and a `flow sdk` path

The intended architecture uses `acpx flow sdk（acpx 流程 SDK）` as the single ACP execution substrate.

## 3. Current phase rule

The current architecture may be capability-constrained, but semantics must remain explicit.

This means:

- current implementation may stay single-primary-agent
- current implementation may not support agent switching or invocation
- current documents must still preserve the long-term semantic boundaries

## 4. Interpretation rule

If a new design proposal conflicts with this glossary, the proposal must be rewritten before it is accepted into the architecture documents.
