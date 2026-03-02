# @agentbridge/core

AgentBridge SDK 核心包 — 类型定义、接口契约、具体实现的统一入口。

## 架构思想

**interfaces 定义契约，实现提供能力，通过工厂模式实现依赖倒置。**

```
┌─────────────────────────────────────────────────────────────┐
│                    packages/core                             │
│                                                              │
│  ┌──────────┐   ┌────────────┐   ┌──────────────────────┐   │
│  │  types   │ → │ interfaces │ ← │ implementations      │   │
│  │ 纯类型    │   │ 接口+工厂   │   │ 平台具体实现          │   │
│  └──────────┘   └────────────┘   └──────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 平台差异分析（基于 free 实际代码）

| 能力 | CLI (Node) | Server (Node) | Server (Edge) | App (RN) |
|------|:----------:|:-------------:|:-------------:|:--------:|
| **Crypto** | tweetnacl + AES-256-GCM | privacy-kit/KeyTree | Web Crypto | libsodium |
| **Storage** | fs (JSON + 文件锁) | Prisma + PostgreSQL | KV | MMKV |
| **SecureStorage** | 加密文件 | - | KV (加密) | Expo SecureStore |
| **Http** | axios | axios | fetch | axios |
| **WebSocket** | socket.io-client | socket.io server | Durable Objects | socket.io-client |
| **Process** | spawn + node-pty | - | ❌ | ❌ |
| **AgentBackend** | ✅ | ❌ | ❌ | ❌ |

---

## 核心接口（基于实际代码）

### 1. AgentBackend

统一不同 AI agent 后端的接口：

```typescript
type SessionId = string;
type ToolCallId = string;

// Agent 消息类型
type AgentMessage =
  | { type: 'model-output'; textDelta?: string; fullText?: string }
  | { type: 'status'; status: 'starting' | 'running' | 'idle' | 'stopped' | 'error'; detail?: string }
  | { type: 'tool-call'; toolName: string; args: Record<string, unknown>; callId: ToolCallId }
  | { type: 'tool-result'; toolName: string; result: unknown; callId: ToolCallId }
  | { type: 'permission-request'; id: string; reason: string; payload: unknown }
  | { type: 'permission-response'; id: string; approved: boolean }
  | { type: 'fs-edit'; description: string; diff?: string; path?: string }
  | { type: 'terminal-output'; data: string }
  | { type: 'event'; name: string; payload: unknown }
  | { type: 'token-count'; [key: string]: unknown }
  | { type: 'exec-approval-request'; call_id: string; [key: string]: unknown }
  | { type: 'patch-apply-begin'; call_id: string; auto_approved?: boolean; changes: Record<string, unknown> }
  | { type: 'patch-apply-end'; call_id: string; stdout?: string; stderr?: string; success: boolean }

type AgentId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'claude-acp' | 'codex-acp';
type AgentTransport = 'native-claude' | 'mcp-codex' | 'acp';

interface AgentBackendConfig {
  cwd: string;
  agentName: AgentId;
  transport: AgentTransport;
  env?: Record<string, string>;
  mcpServers?: Record<string, McpServerConfig>;
}

interface AgentBackend {
  startSession(initialPrompt?: string): Promise<{ sessionId: SessionId }>;
  sendPrompt(sessionId: SessionId, prompt: string): Promise<void>;
  cancel(sessionId: SessionId): Promise<void>;
  onMessage(handler: (msg: AgentMessage) => void): void;
  offMessage?(handler: (msg: AgentMessage) => void): void;
  respondToPermission?(requestId: string, approved: boolean): Promise<void>;
  waitForResponseComplete?(timeoutMs?: number): Promise<void>;
  dispose(): Promise<void>;
}
```

### 2. TransportHandler（ACP 协议特有）

处理不同 agent 的特定行为：

```typescript
interface TransportHandler {
  readonly agentName: string;
  
  // 超时配置
  getInitTimeout(): number;        // Gemini: 120s, Codex: 30s, Claude: 10s
  getIdleTimeout?(): number;       // 空闲检测 (默认 500ms)
  getToolCallTimeout?(toolCallId: string, toolKind?: string): number;
  
  // 输出处理
  filterStdoutLine?(line: string): string | null;
  handleStderr?(text: string, context: StderrContext): StderrResult;
  
  // 工具识别
  getToolPatterns(): ToolPattern[];
  isInvestigationTool?(toolCallId: string, toolKind?: string): boolean;
  extractToolNameFromId?(toolCallId: string): string | null;
  determineToolName?(toolName: string, toolCallId: string, input: Record<string, unknown>): string;
}
```

### 3. ICrypto（加密）

实际使用两套加密模式：legacy (tweetnacl) + dataKey (AES-256-GCM)

```typescript
interface EncryptedData {
  ciphertext: Uint8Array;
  nonce: Uint8Array;   // 12 bytes for GCM, 24 bytes for secretbox
  tag?: Uint8Array;    // 16 bytes auth tag for GCM
}

interface ICrypto {
  getRandomBytes(size: number): Uint8Array;
  
  // === Legacy 模式 (tweetnacl) ===
  // XSalsa20-Poly1305 (secretbox)
  secretbox(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null;
  
  // X25519 + XSalsa20-Poly1305 (box)
  boxKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  box(plaintext: Uint8Array, nonce: Uint8Array, peerPublicKey: Uint8Array, secretKey: Uint8Array): Uint8Array;
  boxOpen(ciphertext: Uint8Array, nonce: Uint8Array, peerPublicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null;
  boxSeal(plaintext: Uint8Array, peerPublicKey: Uint8Array): Uint8Array;
  boxSealOpen(ciphertext: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null;
  
  // === DataKey 模式 (AES-256-GCM) ===
  encryptAesGcm(plaintext: Uint8Array, key: Uint8Array): EncryptedData;
  decryptAesGcm(encrypted: EncryptedData, key: Uint8Array): Uint8Array | null;
  
  // Ed25519 签名
  signKeyPairFromSeed(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array };
  signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verifyDetached(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  
  // 认证挑战
  authChallenge(secret: Uint8Array): { challenge: Uint8Array; publicKey: Uint8Array; signature: Uint8Array };
}
```

**实现**：
- `crypto-node` — Node.js crypto (AES-256-GCM) + tweetnacl
- `crypto-rn` — libsodium-wrappers
- `crypto-edge` — Web Crypto API

### 4. IStorage（键值存储）

```typescript
interface IStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  clear(): Promise<void>;
}
```

**实现**：
- `storage-fs` — Node.js 文件系统 (带文件锁，原子更新)
- `storage-mmkv` — React Native MMKV
- `storage-kv` — Cloudflare KV (Edge)

### 5. ISecureStorage（加密存储）

```typescript
interface ISecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
```

**实现**：
- `secure-storage-fs` — 加密文件存储 (CLI)
- `secure-storage-expo` — Expo SecureStore (App)
- `secure-storage-kv` — 加密 KV (Edge)

### 6. IHttpClient

```typescript
interface IHttpClient {
  get<T>(url: string, config?: RequestConfig): Promise<T>;
  post<T>(url: string, body?: unknown, config?: RequestConfig): Promise<T>;
  put<T>(url: string, body?: unknown, config?: RequestConfig): Promise<T>;
  delete<T>(url: string, config?: RequestConfig): Promise<T>;
}
```

**实现**：`http-axios`, `http-fetch`

### 7. IWebSocketClient

```typescript
interface IWebSocketClient {
  connect(url: string, options?: { auth?: Record<string, string> }): Promise<void>;
  disconnect(): void;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler?: (data: unknown) => void): void;
  emitWithAck?(event: string, data: unknown, timeout?: number): Promise<unknown>;
}
```

**实现**：`ws-socketio-client`, `ws-native`

### 8. IWebSocketServer

```typescript
interface ISocket {
  id: string;
  emit(event: string, data: unknown): void;
  on(event: string, handler: (data: unknown) => void): void;
  timeout(ms: number): { emitWithAck(event: string, data: unknown): Promise<unknown> };
}

interface IWebSocketServer {
  attach(httpServer: unknown): void;
  onConnection(handler: (socket: ISocket) => void): void;
  to(room: string): { emit(event: string, data: unknown): void };
}
```

**实现**：`ws-server-socketio`, `ws-server-durable`

### 9. IProcess（进程管理）

```typescript
interface IProcess {
  pid: number;
  kill(signal?: string): void;
  wait(): Promise<{ code: number }>;
  stdout: AsyncIterable<string>;
  stderr: AsyncIterable<string>;
  stdin: { write(data: string): void };
}

interface IProcessManager {
  spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }): IProcess;
  exec(command: string): Promise<{ stdout: string; stderr: string; code: number }>;
}
```

**实现**：`process-node`, `process-pty`

**注意**：仅 CLI 可用

---

## 通信协议

### WebSocket 事件

```typescript
// === 持久事件 (Persistent) ===
type UpdateEvent =
  | { type: 'new-message'; sessionId: string; message: Message }
  | { type: 'new-session'; sessionId: string; metadata: SessionMetadata; dataEncryptionKey: Uint8Array }
  | { type: 'update-session'; sessionId: string; metadata?: Partial<SessionMetadata> }
  | { type: 'new-machine'; machineId: string; metadata: MachineMetadata }
  | { type: 'update-machine'; machineId: string; metadata?: Partial<MachineMetadata> }
  | { type: 'delete-session'; sessionId: string }
  | { type: 'kv-batch-update'; changes: Array<{ key: string; value: unknown; version: number }> };

// === 临时事件 (Ephemeral) ===
type EphemeralEvent =
  | { type: 'activity'; id: string; active: boolean; thinking?: boolean }
  | { type: 'usage'; id: string; tokens: number; cost: number }
  | { type: 'machine-status'; machineId: string; online: boolean };
```

### RPC 机制

```typescript
// 注册 RPC 处理器
socket.emit('rpc-register', { method: 'permission-response' });

// 调用 RPC
const result = await socket.emitWithAck('rpc-call', {
  method: 'permission-response',
  params: { requestId: 'xxx', approved: true }
});
```

---

## 目录结构

```
packages/core/
├── types/
│   ├── session.ts
│   ├── message.ts
│   ├── machine.ts
│   ├── agent.ts
│   └── index.ts
│
├── interfaces/
│   ├── agent.ts          # AgentBackend + AgentMessage
│   ├── transport.ts      # TransportHandler (ACP)
│   ├── crypto.ts
│   ├── storage.ts
│   ├── http.ts
│   ├── websocket.ts
│   ├── process.ts
│   ├── events.ts         # WebSocket 事件类型
│   └── index.ts
│
├── implementations/
│   ├── agent/
│   │   ├── acp.ts        # ACP 协议后端 (Gemini, Codex-ACP)
│   │   ├── claude.ts     # Claude Code 原生
│   │   └── index.ts
│   │
│   ├── crypto/
│   │   ├── node.ts       # AES-256-GCM + tweetnacl
│   │   ├── rn.ts         # libsodium
│   │   ├── edge.ts       # Web Crypto
│   │   └── index.ts
│   │
│   ├── storage/
│   │   ├── fs.ts         # Node.js 文件系统 + 文件锁
│   │   ├── mmkv.ts       # React Native
│   │   ├── kv.ts         # Cloudflare KV
│   │   └── index.ts
│   │
│   ├── secure-storage/
│   │   ├── fs.ts
│   │   ├── expo.ts
│   │   ├── kv.ts
│   │   └── index.ts
│   │
│   ├── http/
│   │   ├── axios.ts
│   │   ├── fetch.ts
│   │   └── index.ts
│   │
│   ├── websocket/
│   │   ├── socketio-client.ts
│   │   ├── socketio-server.ts
│   │   ├── durable.ts    # Cloudflare Durable Objects
│   │   └── index.ts
│   │
│   ├── process/
│   │   ├── node.ts
│   │   ├── pty.ts
│   │   └── index.ts
│   │
│   └── index.ts
│
├── utils/
│   ├── encoding.ts       # base64, hex
│   └── index.ts
│
├── package.json
└── tsconfig.json
```

---

## 参考

- `apps/free` — 实际使用场景
