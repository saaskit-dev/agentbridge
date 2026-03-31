# CLI Environments

| | 命令 | 数据目录 | LaunchAgent label |
|---|---|---|---|
| **线上** | `free` | `~/.free/` | `app.saaskit.free.daemon` |
| **开发** | `free-dev` | `~/.free-dev/` | `app.saaskit.free.daemon-dev` |

两套环境完全隔离（daemon 进程、session 数据、credentials、日志各自独立）。`./run dev` 启动的是开发环境。

# Architecture Authority

This worktree is for the headless runtime refactor. For architecture work, use the following
source-of-truth order:

1. `docs/architecture/README.md`
2. Explicit user instructions in the current conversation
3. Existing code, only as current-state reference
4. Older RFCs, only as historical background

If current code or older RFCs conflict with the architecture docs, treat the architecture docs
as the target architecture and the codebase as legacy implementation to be migrated.

`README.md` and `README.zh-CN.md` describe the product and current implementation shape. They are
not architecture authority for this worktree.

## Historical RFC Handling

The following RFCs are implementation history, not design authority for this worktree:

- `docs/rfc/003-daemon-agent-architecture.md`
- `docs/rfc/004-agent-bridge-architecture.md`
- `docs/rfc/007-unified-acp-backends.md`

Do not copy their architecture directly into new modules unless the architecture docs explicitly
allow it.

## Refactor Guardrails

- `apps/free/app` is a rendering shell only. Do not add runtime orchestration, encryption,
  persistence policy, or vendor-specific logic there.
- `apps/free/server` must stay vendor-agnostic. Do not add Claude/Codex/Gemini/OpenCode specific
  behavior to server routes, storage semantics, or sync contracts.
- `apps/free/cli` is the runtime boundary. Vendor-specific lifecycle and protocol differences must
  be isolated there behind canonical runtime contracts.
- Prefer canonical Free entities (`Session`, `Participant`, `Task`, `Invocation`, `Event`,
  `Capability`) over vendor-native naming when introducing new types or APIs.
- When a legacy file conflicts with the target model, extract or wrap it. Do not spread the legacy
  pattern into new files.

# Architecture Rules

## No Circular Dependencies

Run `npx madge --circular --extensions ts,tsx sources/` to verify. Zero cycles allowed.

- **Types/constants in separate files** — When a file both exports types and imports its consumers (e.g. a registry that imports components and exports `ToolViewProps`), the types MUST live in a dedicated file (e.g. `types.ts`). Consumers import types from that file, not from the registry.
- **Unidirectional dependencies** — `storage` (state layer) must NOT import from `sync` (business layer). When reverse communication is needed, use the callback registration pattern: `storage.ts` exposes `registerXxxCallback()`, and `sync.ts` registers at init time.
- **Lazy require for cross-cutting concerns** — When a module only calls another module inside event handlers or callbacks (not at init time), use `require()` inside the function body instead of a top-level import, to avoid creating a static dependency edge.

## Route Directory Hygiene

`app/(app)/` is an Expo Router directory — **only page components** (files with `export default`) belong here. Data files, utilities, hooks, and types must go under `@/` (e.g. `@/dev/`, `@/utils/`). Every `Stack.Screen` in `_layout.tsx` must have a corresponding `.tsx` file.

# Logging Convention (RFC-001)

All debug logging must use the unified telemetry Logger — **never `console.log` for debug output**.

```typescript
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('layer/component/name');

logger.debug('message', { key: value });
logger.error('message', { error: String(e) });
```

- `console.log/error` is reserved for **user-facing terminal output only** (CLI chalk messages, QR codes)
- Logs are written to JSONL files with automatic `traceId` correlation across App → Server → CLI → Agent
- Verification: `grep -r "sources/log\|ui/logger\|DANGEROUSLY_LOG" . --include="*.ts"` must return zero results

# Workarounds

When adding any workaround — pnpm patches, Metro/Babel config hacks, Expo config plugins
used to fix third-party bugs, or dependency version pins for compatibility reasons —
**always update `docs/workarounds.md`** with:

- What the workaround does
- Why it's needed (root cause, bug link if available)
- Trigger conditions
- Removal condition (what version/event makes it safe to delete)

# 测试

本地编译 需要使用 ./run dev 本地测试使用 ./run free

改 `packages/core` 的对外类型或导出后，校验 CLI 请用仓库根目录 **`pnpm typecheck`**（Turbo 会先对 `@saaskit-dev/agentbridge` 执行 `build` 再对 CLI 做 `tsc`）。若只单独跑 `apps/free/cli` 的 `pnpm run typecheck`，需先执行 **`pnpm --filter @saaskit-dev/agentbridge run build`**，否则可能读到旧的 `dist` 类型。全仓库含 App 时用 **`pnpm typecheck:all`**（当前 App 若有既有 TS 报错会失败）。

GitHub Actions 里 **Typecheck (core + CLI)** 工作流为 **`workflow_dispatch` 手动触发**，默认不在 push/PR 上自动跑。
