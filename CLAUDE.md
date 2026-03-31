# CLI Environments

| | 命令 | 数据目录 | LaunchAgent label |
|---|---|---|---|
| **线上** | `free` | `~/.free/` | `app.saaskit.free.daemon` |
| **开发** | `free-dev` | `~/.free-dev/` | `app.saaskit.free.daemon-dev` |

两套环境完全隔离（daemon 进程、session 数据、credentials、日志各自独立）。`./run dev` 启动的是开发环境。

# Architecture Rules

## No Circular Dependencies

Run `pnpm run check:deps:madge` to verify circular dependencies. Zero cycles allowed.
Run `pnpm run check:deps:layers` to verify `sync` layer has no static imports from `@/components/*` or `@/realtime/*`.
Use `pnpm run check:deps` to run both checks together.

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
