# @saaskit-dev/agentbridge

[![npm version](https://img.shields.io/npm/v/@saaskit-dev/agentbridge.svg)](https://www.npmjs.com/package/@saaskit-dev/agentbridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Core SDK for AgentBridge — Type definitions, interface contracts, encryption primitives, telemetry, and cross-platform implementations for building AI agent control systems.

## Installation

```bash
npm install @saaskit-dev/agentbridge
# or
pnpm add @saaskit-dev/agentbridge
```

## Entry Points

| Import Path                               | Description                                                          | Environment            |
| ----------------------------------------- | -------------------------------------------------------------------- | ---------------------- |
| `@saaskit-dev/agentbridge`                | Full SDK — all types, interfaces, implementations, encryption, utils | Node.js (CLI / Server) |
| `@saaskit-dev/agentbridge/common`         | Platform-agnostic subset — no `node:*` imports                       | React Native / Browser |
| `@saaskit-dev/agentbridge/types`          | Pure type definitions only                                           | Any                    |
| `@saaskit-dev/agentbridge/interfaces`     | Interface contracts + factory registries                             | Any                    |
| `@saaskit-dev/agentbridge/encryption`     | Encryption primitives (tweetnacl-based)                              | Any                    |
| `@saaskit-dev/agentbridge/telemetry`      | Logging, tracing, sinks (platform-agnostic)                          | Any                    |
| `@saaskit-dev/agentbridge/telemetry/node` | Node.js-specific telemetry (FileSink, log cleanup)                   | Node.js                |

> **React Native / Browser apps** should import from `/common` instead of the root entry point to avoid pulling in Node.js-specific code.

## Architecture

**Interfaces define contracts, implementations provide capabilities, factory patterns enable dependency inversion.**

```
types/           Pure type definitions (session, message, machine, agent, capabilities)
interfaces/      Abstract contracts (ICrypto, IStorage, IHttpClient, IWebSocketClient, IAgentBackend, ...)
implementations/ Platform-specific implementations (Node.js crypto, fs storage, axios, socket.io, ...)
encryption/      End-to-end encryption (SecretBox, Box, AES-256-GCM, wire encoding)
telemetry/       Structured logging with trace correlation and pluggable sinks
utils/           Encoding, async primitives, tmux, caffeinate, etc.
```

## Core Interfaces

### IAgentBackend

Unified interface for different AI agent backends (Claude, Gemini, Codex, OpenCode):

```typescript
import type { IAgentBackend, AgentMessage } from '@saaskit-dev/agentbridge';

// AgentMessage is a discriminated union:
//   'model-output' | 'status' | 'tool-call' | 'tool-result'
//   'permission-request' | 'permission-response' | 'fs-edit'
//   'terminal-output' | 'event'

interface IAgentBackend {
  startSession(initialPrompt?: string): Promise<{ sessionId: string }>;
  sendPrompt(sessionId: string, prompt: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  onMessage(handler: (msg: AgentMessage) => void): void;
  respondToPermission?(requestId: string, approved: boolean): Promise<void>;
  waitForResponseComplete?(timeoutMs?: number): Promise<void>;
  dispose(): Promise<void>;
}
```

**Implementations:** `AcpBackend` (generic ACP protocol), `ClaudeBackend`, and factory functions `createGeminiBackend()`, `createCodexBackend()`, `createClaudeAcpBackend()`, `createOpenCodeBackend()`.

### ITransportHandler

Agent-specific behaviors for the ACP protocol (timeouts, output filtering, tool identification):

```typescript
interface ITransportHandler {
  readonly agentName: string;
  getInitTimeout(): number;
  getIdleTimeout?(): number;
  getToolCallTimeout?(toolCallId: string, toolKind?: string): number;
  filterStdoutLine?(line: string): string | null;
  handleStderr?(text: string, context: StderrContext): StderrResult;
  getToolPatterns(): ToolPattern[];
}
```

**Implementations:** `ClaudeAcpTransport`, `GeminiTransport`, `CodexTransport`, `OpenCodeTransport`, `DefaultTransport`.

### ICrypto

Encryption interface supporting both legacy (tweetnacl secretbox/box) and modern (AES-256-GCM) modes, plus Ed25519 signatures:

```typescript
interface ICrypto {
  getRandomBytes(size: number): Uint8Array;
  // Legacy: tweetnacl secretbox / box / boxSeal
  secretbox(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;
  boxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  // Modern: AES-256-GCM
  encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): EncryptedData;
  decryptAesGcm(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null;
  // Ed25519 signatures
  signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verifyDetached(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
}
```

**Implementation:** `NodeCrypto` (Node.js `crypto` + tweetnacl).

### IStorage / ISecureStorage

```typescript
interface IStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  clear(): Promise<void>;
}
```

**Implementations:** `FsStorage` (filesystem), `EncryptedFsStorage` (encrypted filesystem).

### IHttpClient / IWebSocketClient / IWebSocketServer

HTTP, WebSocket client, and WebSocket server abstractions with factory registration.

**Implementations:** `AxiosHttpClient`, `SocketIoClient`, `SocketIoServer`.

### IProcessManager

Process spawning (CLI only):

```typescript
interface IProcessManager {
  spawn(command: string, args: string[], options?: SpawnOptions): IProcess;
  exec(command: string): Promise<ExecResult>;
}
```

**Implementation:** `NodeProcessManager` / `NodeProcess`.

## Encryption

High-level encryption utilities for end-to-end encrypted sessions:

```typescript
import { SessionEncryption, MachineEncryption, EncryptionCache } from '@saaskit-dev/agentbridge';
// or from '@saaskit-dev/agentbridge/encryption'

// Wire encoding: encrypt → base64 for transport
import { wireEncode, wireDecode } from '@saaskit-dev/agentbridge';
```

- `SecretBoxEncryption` — symmetric (tweetnacl secretbox)
- `BoxEncryption` — asymmetric (tweetnacl box)
- `AES256Encryption` — symmetric (AES-256-GCM)
- `SessionEncryption` / `MachineEncryption` — domain-specific wrappers
- `EncryptionCache` — caches decrypted results

## Telemetry

Structured logging with automatic trace correlation across App → Server → CLI → Agent:

```typescript
import { Logger, initTelemetry } from '@saaskit-dev/agentbridge/telemetry';

const logger = new Logger('my-component');
logger.debug('message', { key: 'value' });
logger.info('info message');
logger.error('failed', new Error('details'));
```

**Sinks:** `ConsoleSink`, `MemorySink`, `RemoteSink` (platform-agnostic), `FileSink` (Node.js via `/telemetry/node`).

**Remote backends:** `AxiomBackend`, `NewRelicBackend`, `ServerRelayBackend`.

## Utils

| Utility                                                                  | Description                       |
| ------------------------------------------------------------------------ | --------------------------------- |
| `encodeBase64` / `decodeBase64` / `encodeHex` / `decodeHex`              | Binary encoding                   |
| `hmacSha512` / `deriveKey` / `deriveSecretKeyTreeRoot`                   | Key derivation (Node.js)          |
| `AsyncLock`                                                              | Async mutex                       |
| `ModeAwareMessageQueue` / `AsyncIterableQueue` / `PushableAsyncIterable` | Async message passing             |
| `atomicFileWrite` / `atomicWriteJson`                                    | Safe file writes (Node.js)        |
| `deterministicStringify` / `hashObject` / `deepEqual`                    | JSON utilities (Node.js)          |
| `safeStringify` / `toError`                                              | Safe serialization                |
| `expandEnvVars`                                                          | Environment variable expansion    |
| `startCaffeinate` / `stopCaffeinate`                                     | Prevent macOS sleep (Node.js)     |
| Tmux utilities                                                           | Session/pane management (Node.js) |

## Factory Pattern

All interfaces use a register/create factory pattern for dependency inversion:

```typescript
import { registerCryptoFactory, createCrypto, NodeCrypto } from '@saaskit-dev/agentbridge';

// Register once at app startup
registerCryptoFactory(() => new NodeCrypto());

// Use anywhere
const crypto = createCrypto();
```

Same pattern for `Storage`, `SecureStorage`, `HttpClient`, `WebSocketClient`, `WebSocketServer`, `ProcessManager`, `AgentBackend`, `TransportHandler`.

## License

MIT
