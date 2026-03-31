# Architecture Index

This directory is the architecture source of truth for the `headless-runtime` worktree.

Read in this order:

1. `001-overview.md`
2. `002-principles.md`
3. `003-entity-model.md`
4. `004-current-runtime-analysis.md`
5. `005-runtime-architecture.md`
6. `006-primary-binding.md`
7. `007-current-runtime-flows.md`
8. `008-glossary-and-invariants.md`
9. `009-open-questions-and-decisions.md`

Use older RFCs in `docs/rfc/` only for legacy context and migration constraints.

## Document roles

- `001-overview.md`
  - top-level system shape
  - goals, non-goals, and first-phase scope
- `002-principles.md`
  - architectural rules and enforced boundaries
- `003-entity-model.md`
  - canonical product entities and their relationships
- `004-current-runtime-analysis.md`
  - factual grounding of current daemon, backend, IPC, and capability reality
- `005-runtime-architecture.md`
  - runtime internal layering, responsibilities, and first-phase constraints
- `006-primary-binding.md`
  - explicit definition of the primary execution binding boundary
- `007-current-runtime-flows.md`
  - grounded current single-primary-agent execution flow
- `008-glossary-and-invariants.md`
  - fixed terminology and hard interpretation rules
- `009-open-questions-and-decisions.md`
  - decision log and deferred/open architecture questions
