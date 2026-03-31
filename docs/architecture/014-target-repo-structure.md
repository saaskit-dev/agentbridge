# Target Repo Structure

- **Status**: Proposed
- **Created**: 2026-03-31

This document defines the target repository shape after the product and architecture are fully aligned around:

- `Free（产品名）`
- `Free daemon runtime（Free 守护进程运行时）`
- `acpx flow sdk（acpx 流程 SDK）` as the sole ACP execution substrate

## 1. Purpose

Renaming the product without redesigning the repository would preserve the current architectural confusion.

The target structure should reflect the intended boundaries:

- product protocol
- product runtime supervision
- flow-sdk integration
- server
- UI
- runtime-first testing

## 2. Target package boundaries

## 2.1 `packages/protocol`

Owns:

- canonical entities
- canonical commands
- canonical events
- shared type contracts

Examples:

- `Session`
- `Message`
- `PrimaryBinding`
- `ExecutionEvent`

This package should remain runtime-agnostic.

## 2.2 `packages/free-runtime`

Owns:

- `Free daemon runtime`
- runtime orchestration
- primary binding supervision
- completion semantics
- runtime fact production
- progress/projection composition

This package should not own UI or server code.

## 2.3 `packages/acpx-flow-bridge`

Owns:

- integration with `acpx flow sdk`
- mapping between Free runtime concepts and `acpx` flow/session identities
- flow-run lifecycle bridging

This package should stay thin.
It should not grow product semantics.

## 2.4 `packages/runtime-testkit`

Owns:

- runtime-focused unit-test helpers
- deterministic fake execution inputs
- test fixtures for completion and failure flows
- integration harnesses for daemon runtime behavior

This package should allow critical flows to be locked down without driving the full product UI.

## 2.5 `apps/free/server`

Owns:

- auth
- persistence
- relay
- synchronization
- server-side projection materialization if needed

It should remain execution-neutral.

## 2.6 `apps/free/app`

Owns:

- rendering
- user input
- local presentation state

It should remain a shell around canonical data and projections.

## 2.7 CLI shell

If a CLI shell remains, it should be treated as:

- a shell around runtime
- not the architectural home of runtime semantics

## 3. What should shrink or disappear

The current repository has overlapping ACP/runtime layering spread across:

- `packages/core`
- `apps/free/cli/src/agent/*`
- `apps/free/cli/src/backends/*`
- `apps/free/cli/src/daemon/sessions/*`

The target structure should reduce that overlap.

Specifically:

- in-repo per-agent ACP runtime logic should shrink
- `apps/free/cli/src/backends/*` should no longer be treated as the long-term ACP execution stack
- runtime supervision should stop being mixed with CLI-specific entrypoint concerns

## 4. Migration intent

This document does not require immediate package extraction.

It does require that future moves be judged against the target structure:

- does a change move code toward protocol/runtime/bridge/server/ui separation
- or does it keep stacking product semantics and ACP mechanics in the same place

## 5. Summary

The target repository should make the architecture legible from the folder structure itself:

- protocol
- runtime
- flow bridge
- runtime testkit
- server
- app

That is the structural counterpart of the architecture documents.
