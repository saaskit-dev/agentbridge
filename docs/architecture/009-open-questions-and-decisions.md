# Open Questions and Decisions

- **Status**: Working decision log
- **Created**: 2026-03-31

This document tracks:

- decisions already made in the architecture discussion
- questions that remain open
- questions intentionally deferred

## 1. Decisions already made

### 1.1 Runtime is the main architecture focus

The daemon runtime is the primary complexity center of the system.
UI and server should be simplified around it.

### 1.2 UI should remain thin

`UI / Client Shell（界面/客户端壳层）` should focus on rendering, user input, and presentation choices.
It should not own ACP-specific execution logic.

### 1.3 Server should remain agent-neutral

`Server（服务端）` should own persistence, auth, sync, and relay concerns.
It should not absorb ACP-specific execution semantics.

### 1.4 Current session model is single-primary-agent

Each current session has one `Primary Agent（主智能体）`.
This is not treated as a permanent semantic limit, but it is the current grounded model.

### 1.5 ACP is the long-term external execution integration path

Future external agent integration should be discussed in terms of `ACP（Agent Client Protocol）`.
The older vendor-specific phrasing should not define the new architecture.

### 1.6 Current completion rule is grounded

The current implementation-level completion rule is:

- `done = ready + flush completed`

### 1.7 `Invocation（调用）` remains a valid long-term model

It should remain a first-class long-term concept, even though it is not yet a current implementation focus.

### 1.8 Detailed execution visibility should remain possible

The runtime must preserve enough facts for:

- simple default UX
- optional expanded execution detail

### 1.9 `acpx sidecar（acpx 侧车）` is the preferred ACP execution substrate

agentbridge should reuse `acpx` for ACP session/runtime mechanics instead of continuing to grow an in-repo per-agent ACP adapter/runtime stack.

### 1.10 `acpx` should not be treated as a stable embedded SDK

The preferred integration mode is sidecar / subprocess integration.
Deep-importing `acpx` runtime internals is treated as a higher-risk fallback, not the default plan.

## 2. Open questions

### 2.1 Is `ready` always the last turn-scoped persisted output?

This still requires deeper runtime validation.

### 2.2 Can a new turn begin before the previous turn settles `flush()`?

This affects whether turn-scoped progress needs stronger isolation.

### 2.3 When should sync failure become user-visible terminal failure?

One `flush()` failure may be transient or terminal depending on runtime behavior.
The exact threshold is still open.

### 2.4 How should `Primary Binding（主绑定）` be represented in code first?

Open options include:

- explicit runtime model first
- extracted internal helper first
- gradual boundary enforcement without immediate object extraction

### 2.5 What is the minimal first externally visible progress model?

Current candidates are:

- internal-only first
- daemon-to-server synced later
- directly IPC-visible first

This remains open because implementation order still depends on runtime validation.

### 2.6 How should agentbridge map `acpx` identities into `Primary Binding（主绑定）`?

The likely answer is to preserve:

- `acpxRecordId`
- `acpxSessionId`
- optional `agentSessionId`

but the exact binding-facing representation is still open.

## 3. Deferred questions

These are real architecture questions, but are intentionally deferred.

### 3.1 Multi-agent invocation UX

The system should preserve the ability to expose invocation detail, but default UI policy is not a current blocker.

### 3.2 Agent switching semantics

`switchAgent（切换智能体）` remains a target capability, but not a phase-1 requirement.

### 3.3 Final runtime-driver protocol

This should not be written as a formal protocol document until more current runtime behavior is grounded and the binding boundary is explicit.

### 3.4 Final UI / Server / Runtime protocol boundaries

These should be formalized after the runtime core documents are stable.

### 3.5 Whether `acpx/flows` should later become the default multi-agent orchestration substrate

`acpx/flows` is a credible future option, but it is not a current phase-1 dependency.

### 3.6 Final truth/projection persistence strategy

The truth/projection split is now documented, but the exact first code landing shape for:

- daemon-local projection
- server-synced projection
- rebuildable projection

remains implementation-sequencing work rather than a settled final design.

## 4. Use rule

When a future architecture discussion starts from a fresh context, this document should be used to distinguish:

- settled decisions
- still-open validation questions
- intentionally deferred topics
