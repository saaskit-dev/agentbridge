# RFC-008: CLI-Server Testing Strategy

- **Status**: Partially Implemented（核心基础设施已就绪，覆盖持续扩展中）
- **Created**: 2026-03-15
- **Last Updated**: 2026-03-16

## Background

Recent issues exposed a structural testing gap:

- Problems in ACP capability discovery were only noticed after going through the full product flow.
- Agent startup failures could look like "no data returned" from the product perspective even when the real problem was earlier in the CLI or ACP handshake layer.
- The App currently acts as an accidental end-to-end validator for CLI and Server behavior, which delays detection and makes failures harder to localize.

This document defines a testing strategy that moves detection earlier:

1. Validate ACP protocol and capability mapping before runtime.
2. Validate CLI and Server interaction without depending on the App UI.
3. Keep the App as a consumer-layer verification target, not the primary place where core transport bugs are discovered.

## Core Principle

The CLI and Server interaction path must be testable independently of the App.

The App should not be required to validate:

- session creation
- message roundtrip
- capability persistence
- agent state updates
- agent startup failure handling
- socket update delivery

Instead, tests should simulate App behavior directly against Server and CLI protocols.

## Primary Goals

The testing system should catch the following classes of failure before full product E2E:

- ACP discovery fields missing or silently dropped
- newly introduced ACP session update types not handled
- agent startup and handshake failures
- capabilities written by CLI but not persisted or broadcast by Server
- messages stored by Server but not replayable to clients
- user-visible errors missing even though internal logs contain the root cause
- multi-session isolation bugs
- version mismatch and reconnection bugs

## Non-Goals

This document does not attempt to replace all App-layer tests.

It does not define:

- detailed visual UI testing
- screenshot testing
- accessibility testing
- product-level feature walkthroughs unrelated to CLI-Server transport

Those remain valuable, but they sit above the core transport and session lifecycle tests described here.

## Test Architecture

### Layer 1: Pure Unit Tests

Purpose:

- validate mapping logic
- validate schema compatibility
- validate state transitions
- validate failure classification

No real Server, daemon, socket, or agent process should be required.

Targets:

- ACP capability mapping
- raw message to normalized message mapping
- reducer-like transforms
- version conflict behavior
- error-to-user-visible-message conversion

### Layer 2: Component Integration Tests

Purpose:

- validate one subsystem with realistic collaborators, but not the whole product

Examples:

- real CLI ACP backend with fake ACP transport
- real `ApiSession` with fake socket server
- real Server socket handlers with fake client

Targets:

- ACP backend session update handling
- capability update persistence contract
- message ordering and dedupe behavior

### Layer 3: CLI-Server Integration Tests

Purpose:

- validate the main product transport path without the App

This is the most important layer to strengthen.

Environment:

- real Server
- real daemon / CLI session objects
- fake App client
- fake ACP agent or stub backend

What this layer should prove:

- creating a session works
- posting a user message reaches the CLI
- agent output returns to the Server as persisted messages
- capability updates are persisted and broadcast
- errors become visible to a client, not just to logs

### Layer 4: Real Agent Smoke Tests

Purpose:

- validate that each real agent binary can initialize and perform a minimal prompt roundtrip

Environment:

- real Server
- real daemon
- fake App client
- real agent binary

This layer should remain intentionally small and stable.

### Layer 5: App Consumer Tests

Purpose:

- validate that the App correctly consumes protocol outputs already proven by lower layers

This layer should verify:

- session store updates
- capability consumption
- command suggestions
- empty/error state rendering

It should not be the main detector of protocol regressions.

## Required Test Harnesses

### 1. Fake App Client

A reusable test utility that simulates the protocol behavior of the App without starting the App itself.

Recommended responsibilities:

- authenticate as a user
- call REST session routes
- call `/v3/sessions/:id/messages`
- connect to Server socket
- collect `new-session` updates
- collect `new-message` updates
- collect `update-session` updates
- collect ephemerals
- decrypt metadata, capabilities, agent state, and messages
- provide `waitFor*` helpers for assertions

Recommended location:

- `apps/free/server/src/testkit/`
- or a shared testkit directory if both CLI and Server tests need it

### 2. Fake ACP Agent

A protocol-level test double used to drive deterministic ACP behavior.

It should support:

- successful initialize
- initialize timeout
- new session response with capability payload
- scripted session update sequence
- text output
- thinking output
- tool call and tool result updates
- malformed or unknown updates

### 3. Assertion Helpers

Reusable assertions reduce duplicated low-signal test code.

Recommended helpers:

- `expectSessionCapabilities`
- `expectCapabilityVersionIncremented`
- `expectLatestMessageContains`
- `expectMessageCount`
- `expectVisibleError`
- `expectArchivedState`
- `expectSessionUpdateDelivered`

### 4. Fixture Library

ACP and session lifecycle fixtures should be committed as explicit contract samples.

Recommended fixture types:

- `newSessionResponse.codex.json`
- `newSessionResponse.claude.json`
- `newSessionResponse.gemini.json`
- `sessionUpdate.available_commands_update.json`
- `sessionUpdate.current_mode_update.json`
- `sessionUpdate.config_option_update.json`
- `sessionUpdate.tool_call.json`
- `sessionUpdate.tool_call_update.json`
- `sessionUpdate.agent_message_chunk.json`
- `sessionUpdate.unknown_type.json`
- `sessionUpdate.error.json`

## Coverage Plan by Domain

### A. Capability Discovery and Capability Persistence

This domain is responsible for preventing missing capability fields from reaching runtime.

Coverage:

- map initial ACP discovery snapshot into internal capability model
- map all known capability update types
- preserve per-session isolation
- validate empty and partial capability payloads
- validate version increment behavior on Server persistence
- validate client receives `update-session` after `update-capabilities`
- validate decrypted client-side result matches original capability payload

Key risks this layer must catch:

- models missing
- modes missing
- commands missing
- future ACP discovery fields silently discarded
- version mismatch behavior breaking updates

### B. ACP Session Update Handling

This domain is responsible for handling the ACP protocol event stream.

Coverage:

- `onSessionStarted` receives initial capability snapshot
- `onSessionUpdate` receives all known ACP session update types
- `available_commands_update` enters the capability pipeline
- `agent_message_chunk` maps into visible output
- `tool_call` and `tool_call_update` map correctly
- status transitions map correctly
- initialize timeout becomes structured visible failure
- unknown update type is explicitly logged and covered by tests

Key requirement:

Known ACP session update types must be tracked by an explicit coverage table.
If the SDK introduces a new update type and code does not handle it, tests should fail.

### C. Raw Message Mapping

This domain validates that agent-originated messages become stable normalized messages.

Coverage:

- text output
- thinking output
- tool call
- tool result
- running / idle / error status
- token usage events
- approval-request-like messages
- patch apply begin/end
- unknown raw messages

Key risk:

An agent may be producing output correctly while the product appears blank because mapping discards or misclassifies the message.

### D. Session Lifecycle in Daemon

This domain validates the daemon-owned session object.

Coverage:

- initialize
- metadata setup
- callback registration
- output pipe startup
- capability pipe startup
- user message queueing
- pre-init queue replay
- backend output forwarding
- capability forwarding
- status changes
- abort
- shutdown
- backend end-of-stream
- init failure
- backend send failure
- disconnect and loop termination

Key requirement:

Startup or initialization failure must result in a user-visible error path, not just structured logs.

### E. Server Message and Session Protocol

This domain validates Server behavior independently from the App UI.

Coverage:

- `GET /v3/sessions/:id/messages`
- `POST /v3/sessions/:id/messages`
- pagination
- `after_seq`
- duplicate `localId` handling
- `update-capabilities`
- `update-state`
- `new-session` updates
- ownership and auth checks
- multi-subscriber broadcast behavior
- reconnect and replay compatibility

Key risk:

The Server can appear healthy while silently dropping updates, broadcasting stale versions, or returning inconsistent session state.

### F. CLI-Server Mainline Integration

This is the most important functional test layer.

The App is replaced by a fake protocol client.

Minimum required scenarios:

1. Create a session.
2. Send a user message.
3. Receive a normal agent reply.
4. Receive initial capability discovery.
5. Receive capability increments such as commands or mode changes.
6. Receive tool call and tool result.
7. Receive streaming/thinking output in order.
8. Receive visible error when the backend fails.
9. Observe archived session state after termination.
10. Verify multiple sessions do not cross-contaminate.

This layer should become the main gate for core transport correctness.

### G. Real Agent Smoke

This domain validates that real agent binaries remain usable in the current environment.

Each supported agent should have at least:

- handshake smoke
- initial capability smoke
- one-prompt smoke

Recommended agent list:

- claude
- claude-acp
- codex
- codex-acp
- gemini
- opencode

These tests should stay intentionally minimal so they remain debuggable and reliable.

### H. App Consumer Layer

This domain validates App consumption of proven protocol behaviors.

Coverage:

- session reducer applies capability updates
- command suggestions use metadata slash commands and persisted capability commands
- session screen handles error-only sessions without appearing blank
- model and mode selectors reflect persisted capabilities

## Test Matrix by Functional Area

### Session

- create
- load
- reconnect
- archive
- concurrent sessions

### Message

- user message
- agent text
- thinking
- tool-call
- tool-result
- error
- pagination
- dedupe
- ordering

### Capabilities

- initial discovery
- incremental update
- partial update
- null update
- version conflict
- per-session isolation

### Agent State

- idle
- working
- permission request
- permission resolution

### Failure Modes

- initialize timeout
- process exit
- malformed update
- unknown update type
- version mismatch
- disconnect
- decryption error

## Recommended Implementation Phases

### Phase 1: Build the Foundation

Deliverables:

- Fake App Client
- Fake ACP Agent
- shared assertion helpers
- one happy-path CLI-Server integration test
- one capability roundtrip test
- one visible init-timeout failure test

Exit criteria:

- a core user-message roundtrip can be tested without the App
- a capability update can be tested without the App
- a startup failure can be asserted without reading raw logs

### Phase 2: Lock Capability Contracts

Deliverables:

- capability fixture suite
- update type coverage tests
- capability persistence versioning tests

Exit criteria:

- discovery regressions fail in unit or component integration tests
- newly introduced ACP session update types become visible in CI

### Phase 3: Expand CLI-Server Mainline Scenarios

Deliverables:

- tool-call and tool-result roundtrip tests
- thinking and streaming tests
- session archive tests
- multi-session isolation tests

Exit criteria:

- the main protocol flow is covered without depending on App UI

### Phase 4: Add Real Agent Smoke Coverage

Deliverables:

- minimal smoke for each supported agent
- handshake timeout detection
- one prompt roundtrip per agent

Exit criteria:

- environment and agent-binary regressions surface before full product tests

### Phase 5: Reduce App Burden

Deliverables:

- App tests narrowed to consumer behavior
- command suggestion consumption tests
- empty/error state rendering tests

Exit criteria:

- App tests no longer function as the main validator for CLI-Server correctness

## CI Strategy

### PR Gate

Must run on every pull request:

- pure unit tests
- component integration tests
- core CLI-Server integration cases using fake ACP agents

Goal:

- fail fast on logic, protocol, and persistence regressions

### Main Branch Gate

Must run on merges to main:

- everything from PR gate
- broader CLI-Server integration suite
- stubbed or controlled backend smoke tests

Goal:

- catch deeper interaction bugs without relying on flaky full-E2E timing

### Nightly

Should run on a schedule:

- real agent smoke tests
- longer reconnection tests
- multi-session concurrency tests

Goal:

- catch environment drift, binary regressions, and long-tail protocol issues

## Initial Priority Worklist

The first work items should target the highest-leverage failure classes.

Priority 0:

- build Fake App Client
- add one end-to-end CLI-Server happy-path test
- add one visible `codex-acp` init-timeout test

Priority 1:

- expand ACP capability contract fixtures
- add known session update type coverage checks
- validate `available_commands_update` through to persisted capabilities

Priority 2:

- add tool-call and tool-result roundtrip tests
- add multi-session isolation tests
- add reconnect and replay tests

Priority 3:

- add real-agent smoke for all supported agents
- trim App tests to consumer-only verification

## Required Quality Gates

The strategy is working only if the following regressions are caught before full product flow:

- capability discovery missing required data
- capability updates not persisted or not broadcast
- agent startup timeout
- visible reply missing because mapper dropped content
- session appears empty even though failure occurred
- messages cross session boundaries
- version mismatch breaks eventual consistency

## Operating Rule Going Forward

Before adding or changing any agent capability, transport behavior, or session lifecycle logic, tests should be added at the lowest meaningful layer first:

1. mapping or contract test
2. component integration test
3. CLI-Server integration test
4. only then App consumer coverage if needed

This keeps regressions localized and avoids discovering protocol bugs only at the very end of the product flow.

---

## 实现归档（2026-03-16）

### 已实现的测试基础设施

| 组件                    | RFC 描述 | 实现文件                                                   | 状态                        |
| ----------------------- | -------- | ---------------------------------------------------------- | --------------------------- |
| Fake App Client         | §1       | `cli/src/test-helpers/FakeAppClient.ts`（245 行）          | ✅                          |
| Fake CLI Session Client | —        | `cli/src/test-helpers/FakeCliSessionClient.ts`（87 行）    | ✅（RFC 未提，额外实现）    |
| Integration Environment | —        | `cli/src/test-helpers/integrationEnvironment.ts`（180 行） | ✅（RFC 未提，额外实现）    |
| Daemon Test Harness     | —        | `cli/src/test-helpers/daemonTestHarness.ts`（110 行）      | ✅（RFC 未提，额外实现）    |
| Fake ACP Agent          | §2       | —                                                          | ❌ 未实现                   |
| Assertion Helpers       | §3       | 内联在各测试文件中                                         | ⚠️ 部分（未提取为独立模块） |
| Fixture Library         | §4       | —                                                          | ❌ 未实现                   |

### 已实现的测试文件

| 测试文件                                             | 对应 RFC 层级                    | 测试数             |
| ---------------------------------------------------- | -------------------------------- | ------------------ |
| `cli/src/api/messageLifecycle.integration.test.ts`   | Layer 3 (CLI-Server Integration) | 4                  |
| `cli/src/api/cliServerRoundtrip.integration.test.ts` | Layer 3 (CLI-Server Integration) | 3                  |
| `cli/src/daemon/daemon.integration.test.ts`          | Layer 3 (Daemon lifecycle)       | 11                 |
| `cli/src/api/daemonAgentSmoke.integration.test.ts`   | Layer 4 (Real Agent Smoke)       | 2（env 门控）      |
| `cli/src/__tests__/acpSdkAgentMatrix.test.ts`        | Layer 4 (ACP SDK Matrix)         | 进行中（env 门控） |
| `app/sources/__tests__/e2e-scenarios.ts`             | Layer 5 (App Consumer)           | 18 场景            |

### 各层覆盖状态

| Layer   | 名称                   | 状态      | 说明                                                               |
| ------- | ---------------------- | --------- | ------------------------------------------------------------------ |
| Layer 1 | Pure Unit Tests        | ✅ 已有   | `reducer.spec.ts`、`typesRaw.spec.ts`、`encryption.test.ts` 等     |
| Layer 2 | Component Integration  | ⚠️ 部分   | `FakeCliSessionClient` + `FakeAppClient` 存在，Fake ACP Agent 缺失 |
| Layer 3 | CLI-Server Integration | ✅ 实质性 | messageLifecycle + cliServerRoundtrip + daemon lifecycle           |
| Layer 4 | Real Agent Smoke       | ✅ 存在   | `FREE_RUN_REAL_AGENT_SMOKE=1` 门控                                 |
| Layer 5 | App Consumer Tests     | ✅ 存在   | Metro module injection (RFC-008)                                   |

### 尚未实现

1. **Fake ACP Agent**：确定性 ACP 行为双测（scripted capability responses + session updates）
2. **Fixture Library**：各 agent 的 `newSessionResponse.json`、`sessionUpdate.*.json` 样本
3. **CI 自动化**：浏览器 E2E 目前仅支持手动执行
4. **Multi-session isolation tests**：多 session 并发隔离测试
