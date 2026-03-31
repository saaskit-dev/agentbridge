# Headless Runtime Architecture Overview

- **Status**: Proposed
- **Created**: 2026-03-30

## Summary

Free targets a three-layer system:

1. `App/UI` is a thin rendering and input shell
2. `Server` is an agent-agnostic persistence, auth, sync, and relay layer
3. `CLI/Daemon Runtime` is the product supervision layer and delegates ACP execution to `acpx sidecar（acpx 侧车）`

The product core is the runtime plus the canonical protocol. UI, server, and tests should all
consume canonical Free entities instead of vendor-native session models.

Agent-to-agent invocation is a first-class runtime capability.

## Goal model

The target system is intentionally simple in shape:

- `App/UI` renders canonical data and dispatches canonical commands
- `Server` persists canonical state, relays canonical events, and enforces agent-agnostic policy
- `Runtime` owns product supervision, lifecycle control, capability normalization, and orchestration
- `Runtime` should reuse `acpx sidecar（acpx 侧车）` for ACP session/runtime mechanics rather than rebuilding per-agent ACP integration in-repo

This implies the following product model:

- `Session` is a Free-owned continuous working context, not a vendor-native session
- `Participant` is a session-level actor identity
- `Agent` is a runtime-managed execution entity and may back a participant
- `Task` is a work unit inside a session
- `Invocation` is a first-class runtime request between participants, usually agent-backed
- `Message` is a communication record, not the container for all product semantics
- `Artifact` is a first-class work product
- `Capability` is the explicit model for behavioral differences

## Problem statement

The current codebase has useful layers, but the actual responsibility split is not enforced:

- app contains runtime orchestration and synchronization logic
- server contains session and socket flows mixed with process-wide singletons
- cli/daemon contains the real runtime, but its abstractions are not yet the single source of truth
- agent-specific behavior leaks into places that should be vendor-agnostic

## Design goals

### Primary goals

- app remains almost entirely free of business and runtime logic
- server remains ignorant of vendor-specific agent behavior
- runtime becomes the only home for vendor differences and lifecycle control
- runtime reuses `acpx sidecar（acpx 侧车）` as the preferred ACP execution substrate
- all product-facing layers operate on canonical Free protocol types
- session identity belongs to Free, not to any vendor
- agent-to-agent invocation is supported without leaking vendor details to app or server

### Secondary goals

- new UI shells should be cheap to add
- new ACP-backed execution providers should be cheap to add by reusing the `acpx sidecar（acpx 侧车）` substrate through one thin bridge boundary
- session switching between agents should be possible through canonical snapshots
- domain logic should be unit-testable without React, sockets, or child processes

### Non-goals

- perfect lossless migration between all vendor-native sessions
- erasing all vendor-specific capability differences
- immediate full rewrite of the repository
- embedding unstable `acpx` internals directly into the agentbridge daemon process

## First-phase scope

The first phase of the refactor should establish the model and boundaries, not build the final
feature-complete system.

The first phase should achieve:

- app as rendering shell plus presentation mapping only
- server as vendor-agnostic persistence and relay layer
- runtime as the only owner of vendor adaptation and agent lifecycle
- `acpx sidecar（acpx 侧车）` introduced as the preferred ACP execution integration path
- canonical entities defined explicitly in shared protocol types
- capability differences exposed through structured capability data

The first phase does not need to achieve:

- perfect `switchAgent()` behavior
- a full workflow engine
- full multi-agent collaborative orchestration
- zero local runtime in app processes
- immediate extraction of `packages/runtime`

## Further reading

- `002-principles.md`
- `003-entity-model.md`
- `004-current-runtime-analysis.md`
- `013-ui-server-runtime-boundaries.md`
- `../rfc/013-headless-runtime-architecture.md`
