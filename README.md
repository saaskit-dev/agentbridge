# AgentBridge

Universal SDK for AI Coding Agent CLIs - Connect any AI coding agent to your application with end-to-end encryption.

## Features

- **Multi-Agent Support**: Works with Claude Code, Codex, Cursor, Aider, and more
- **End-to-End Encryption**: X25519 + AES-256-GCM encryption for all communications
- **Real-time Sync**: WebSocket-based synchronization with InvalidateSync pattern
- **React Integration**: Ready-to-use hooks and components
- **Extensible**: Plugin architecture for adding new AI agents

## Packages

| Package | Description |
|---------|-------------|
| `@agentbridge/core` | Core SDK with encryption, transport, and sync |
| `@agentbridge/react` | React hooks and provider components |
| `@agentbridge/adapter-claude` | Claude Code adapter |
| `@agentbridge/adapter-codex` | Codex (OpenAI) adapter |

## Installation

```bash
# Core SDK
pnpm add @agentbridge/core

# React integration
pnpm add @agentbridge/react

# Adapters (choose what you need)
pnpm add @agentbridge/adapter-claude
pnpm add @agentbridge/adapter-codex
```

## Quick Start

### 1. Initialize SDK

```typescript
import { createSDK } from '@agentbridge/core';
import { claudeAdapter } from '@agentbridge/adapter-claude';

const sdk = createSDK({
  connection: {
    serverUrl: 'wss://your-server.com',
  },
  encryption: {
    masterSecret: 'your-secret-key',
  },
  defaultAgent: 'claude',
});

// Register adapters
sdk.registerAdapter(claudeAdapter);

// Initialize
await sdk.initialize();
```

### 2. React Integration

```tsx
import { SDKProvider, useSessions, useSession } from '@agentbridge/react';

function App() {
  return (
    <SDKProvider
      config={{
        connection: { serverUrl: 'wss://your-server.com' },
        encryption: { masterSecret: 'your-secret-key' },
      }}
    >
      <SessionList />
    </SDKProvider>
  );
}

function SessionList() {
  const { sessions, create, isLoading } = useSessions();

  const handleCreate = async () => {
    await create('machine-id', {
      workingDir: '/path/to/project',
      permissionMode: 'default',
    });
  };

  return (
    <div>
      <button onClick={handleCreate}>New Session</button>
      {sessions.map(session => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}

function SessionCard({ sessionId }: { sessionId: string }) {
  const { session, messages, sendMessage } = useSession({ sessionId });

  return (
    <div>
      <h3>{session?.workingDir}</h3>
      {messages.map(msg => (
        <Message key={msg.id} message={msg} />
      ))}
      <input
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            sendMessage(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
      />
    </div>
  );
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Application                        │
├─────────────────────────────────────────────────────────────┤
│                     @agentbridge/react                       │
│  (SDKProvider, useSessions, useSession, useDevices, etc.)   │
├─────────────────────────────────────────────────────────────┤
│                     @agentbridge/core                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Encryption  │  │  Transport  │  │   SyncEngine        │  │
│  │ (libsodium) │  │ (WebSocket) │  │ (InvalidateSync)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                     Adapters                                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Claude    │  │   Codex    │  │   Cursor   │  ...       │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    AI Coding Agent CLIs
              (Claude Code, Codex, Cursor, Aider...)
```

## Creating a Custom Adapter

```typescript
import type { AgentAdapter, NormalizedMessage } from '@agentbridge/core';

export class MyAgentAdapter implements AgentAdapter {
  readonly id = 'my-agent';
  readonly name = 'My Agent';
  readonly version = '1.0.0';

  normalizeMessage(raw: unknown, sessionId: string): NormalizedMessage {
    // Convert your agent's format to NormalizedMessage
    return {
      id: (raw as any).id,
      sessionId,
      role: (raw as any).role,
      content: (raw as any).content,
      timestamp: Date.now(),
      flavor: this.id,
    };
  }

  getToolRegistry() { /* ... */ }
  getPermissionModes() { /* ... */ }
  getCLIArgs(options) { /* ... */ }
  parseOutputStream(data) { /* ... */ }
  isValidMessage(data) { /* ... */ }
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev
```

## License

MIT
