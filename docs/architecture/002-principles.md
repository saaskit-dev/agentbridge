# Architecture Principles

## Canonical model first

Free defines its own product entities and event model. Vendor protocols are mapped into them.
UI renders them. Server stores and relays them. Runtime owns the mapping.

## Protocol first

Layers communicate through stable protocols, not by reaching into each other's internals.
If a feature cannot be expressed through the protocol, the protocol is incomplete.

## Runtime owns complexity

All vendor-specific complexity, process lifecycle handling, permission differences,
capability discovery, and switching logic must be trapped inside the runtime layer.

## UI is a shell

UI may format, sort, group, and stage input, but it must not own:

- sync orchestration
- encryption
- persistence policies
- retry policies
- tool approval semantics
- vendor capability branching
- agent lifecycle management

## Server is neutral

Server must remain unaware of vendor-specific agent semantics. It should only operate on:

- canonical sessions
- canonical messages and events
- canonical tool calls
- canonical capabilities
- auth, persistence, relay, and coordination concerns

## Session belongs to Free

A Free session is not a vendor-native session. Vendor-native identifiers are implementation
details stored under runtime state.

## Enforced boundaries

The following dependencies should be considered violations in the target architecture:

- app screen importing runtime internals directly
- app importing encryption, socket, persistence, or sync orchestration directly
- server code branching on vendor agent kind for core business logic
- server storing vendor-native wire payloads as product truth
- runtime leaking vendor-native event formats above the driver boundary
- UI components importing state mutation logic with hidden side effects
