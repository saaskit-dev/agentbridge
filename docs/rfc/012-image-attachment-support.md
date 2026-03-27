# RFC-012: Image Attachment Support

## Status

Design complete, not yet implemented.

## Problem

App 目前只支持纯文字消息。用户无法向 Agent 发送图片，限制了截图调试、UI 审查、视觉问题反馈等场景。

## Goals

- App 侧可选择图片、预览并随消息发送
- 图片以近实时方式传达到 Daemon 本地磁盘
- ACP agent 通过 `resource_link` 读取本地文件
- Server 不持久化图片数据（纯管道）
- App 侧图片状态确定（同步 ack）

## Non-Goals

- 视频/音频支持
- ClaudeNativeBackend（PTY / SDK 模式）图片支持（v1 降级为纯文字）
- 跨机器图片迁移（图片绑定到上传时的 Daemon 机器）
- 图片 E2E 加密（图片走独立 WS 事件，TLS 保护传输，Server 可见明文）

## Architecture

### 传输链路

```
App 选图
  → copy URI 到持久目录（iOS 临时 URI 防回收，必须在压缩前）
  → expo-image-manipulator 压缩（max 2048px / JPEG or PNG / 上限 8MB）
  → emitWithAck('upload-attachment', { sessionId, data: Buffer, mimeType, filename? })
        ↓ Server 同步等待 Daemon ack（最多 15s）
  → Server 验证 session 归属 → 转发 daemonSocket.emitWithAck('file-transfer', { id, data, mimeType, filename? })
        ↓ Daemon 同步处理
  → Daemon 白名单校验 mimeType → 写 ~/.free/attachments/<id>.<ext>（chmod 0600）→ ack { ok: true }
        ↓
  → Server ack 回 App { ok: true, attachmentId: id }
    或 { ok: false, error: 'daemon_offline' | 'daemon_error' }

App 拿到 attachmentId → 发消息 { text, attachments: [{ id, mimeType, thumbhash?, filename? }] }
Daemon 处理消息 → id 拼本地路径 → 构造 resource_link ContentBlock → 传 ACP agent
```

### 为什么全走 WebSocket

- Server 无法主动 HTTP 连接 Daemon（Daemon 在用户本地机器，有 NAT）
- WS 是 Daemon 与 Server 之间唯一的双向通道
- 图片不存 DB，只在 Daemon 本地磁盘
- `emitWithAck` 双层同步 ack，App 状态完全确定

## Detailed Design

### 1. Types (`packages/core/src/types/message.ts`)

```typescript
export interface AttachmentRef {
  id: string;          // cuid，用于在 Daemon 本地查找文件
  mimeType: string;    // 'image/jpeg' | 'image/png' | 'image/webp'
  thumbhash?: string;  // Base64，客户端计算，用于历史消息占位图
  filename?: string;
}

// UserMessage.content 新增可选字段
export interface UserMessage {
  role: 'user';
  content: {
    type: 'text';
    text: string;
    attachments?: AttachmentRef[];  // 新增，可选，向下兼容
  };
  localKey?: string;
  meta?: MessageMeta;
}
```

### 2. Server (`apps/free/server/src/app/api/socket.ts`)

```typescript
const io = new Server(app.server, {
  maxHttpBufferSize: 10 * 1024 * 1024,  // 新增，10MB
  // ...其他不变
});
```

### 3. Server (`apps/free/server/src/app/api/socket/attachmentHandler.ts`) — 新增

处理 App 侧的 `upload-attachment` 事件：

```typescript
socket.on('upload-attachment', async ({ sessionId, data, mimeType, filename }, ack) => {
  // 1. 验证 session 归属当前用户
  // 2. 找到该 session 对应的 daemon socket（session-scoped connection）
  // 3. 生成 id = cuid()
  // 4. 使用 Socket.IO 内置 timeout，超时/断连自动 reject，无需手动管理 ack Map
  try {
    await daemonSocket.timeout(15_000).emitWithAck('file-transfer', { id, sessionId, data, mimeType, filename });
    ack({ ok: true, attachmentId: id });
  } catch {
    ack({ ok: false, error: 'daemon_offline' });
  }
});
```

注意：
- `sessionId` 用于鉴权（验证 App 用户拥有该 session）

### 4. Daemon (`apps/free/cli/src/daemon/sessions/AgentSession.ts`)

新增成员：

```typescript
// 与 messageQueue 严格同步的并行队列
private pendingAttachments: LocalAttachment[][] = [];
private readonly attachmentsDir = path.join(FREE_HOME_DIR, 'attachments');
```

**`file-transfer` 事件路由**：与 `onUserMessage` 一样，走 `ApiSessionClient` session-scoped 回调，不在 daemon 顶层做路由。

在 `ApiSessionClient` 新增：
```typescript
onFileTransfer(callback: (data: FileTransferPayload) => void): void
// 内部监听 WS 'file-transfer' 事件，触发时调用 callback
```

`AgentSession.initialize()` 注册：
```typescript
this.session.onFileTransfer(async ({ id, data, mimeType }, ack) => {
  // 1. 白名单校验 mimeType：只允许 image/jpeg, image/png, image/webp, image/gif
  // 2. 白名单映射取后缀（防路径注入）
  await this.receiveAttachment(id, Buffer.from(data), MIME_TO_EXT[mimeType] ?? 'jpg');
  ack({ ok: true });
});

// AgentSession.receiveAttachment
async receiveAttachment(id: string, data: Buffer, ext: string): Promise<void> {
  await fs.mkdir(this.attachmentsDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(this.attachmentsDir, `${id}.${ext}`);
  await fs.writeFile(filePath, data, { mode: 0o600 });
}
```

`onUserMessage` 改动（使用 `pushIsolateAndClear` 防 MessageQueue2 批处理导致 pendingAttachments 错位）：

```typescript
this.session.onUserMessage(msg => {
  if (!this.messageQueue) return;

  const attachments = (msg.content.attachments ?? []).map(({ id, mimeType }) => {
    const ext = MIME_TO_EXT[mimeType] ?? 'jpg';  // 白名单映射
    return { localPath: path.join(this.attachmentsDir, `${id}.${ext}`), mimeType };
  });

  this.pendingAttachments.push(attachments);
  // pushIsolateAndClear 防止与其他消息合并，保证 pendingAttachments 一对一
  this.messageQueue.pushIsolateAndClear(msg.content.text, this.extractMode(msg));
});
```

`messageLoop` 同步 pop 两个队列：

```typescript
const item = await this.messageQueue.waitForMessagesAndGetAsString();
const attachments = this.pendingAttachments.shift() ?? [];
await this.backend.sendMessage(item.message, permissionMode, attachments.length ? attachments : undefined);
```

`preInitQueue` 存 attachmentRefs，回放时构造路径。同时 `sendInput()`（CLI 交互路径）推入 `preInitQueue` 时补 `attachmentRefs: []`：

```typescript
private preInitQueue: Array<{ text: string; attachmentRefs: AttachmentRef[] }> = [];

// sendInput（CLI 路径，无附件）
sendInput(text: string): void {
  if (!this.messageQueue) {
    this.preInitQueue.push({ text, attachmentRefs: [] });  // 补空数组
    return;
  }
  this.pendingAttachments.push([]);
  this.messageQueue.pushIsolateAndClear(text, this.defaultMode());
}

// 回放（initialize 完成后）
for (const { text, attachmentRefs } of this.preInitQueue) {
  const attachments = attachmentRefs.map(({ id, mimeType }) => ({
    localPath: path.join(this.attachmentsDir, `${id}.${MIME_TO_EXT[mimeType] ?? 'jpg'}`),
    mimeType,
  }));
  this.pendingAttachments.push(attachments);
  this.messageQueue.pushIsolateAndClear(text, this.defaultMode());
}
this.preInitQueue = [];
```

### 5. Daemon (`apps/free/cli/src/daemon/sessions/cleanAttachments.ts`) — 新增

Daemon 启动时调用一次：

```typescript
export async function cleanStaleAttachments(dir: string, maxAgeDays = 7): Promise<void> {
  // stat 每个文件，mtime 超过 maxAgeDays 则删除
}
```

### 6. Daemon (`apps/free/cli/src/daemon/sessions/AgentBackend.ts`)

```typescript
export interface LocalAttachment {
  localPath: string;
  mimeType: string;
}

export interface AgentBackend {
  // ...
  sendMessage(text: string, permissionMode?: PermissionMode, attachments?: LocalAttachment[]): Promise<void>;
}
```

### 7. ACP (`apps/free/cli/src/backends/acp/DiscoveredAcpBackendBase.ts`)

```typescript
import type { ContentBlock } from '@agentclientprotocol/sdk';

async sendMessage(text: string, permissionMode?: PermissionMode, attachments?: LocalAttachment[]): Promise<void> {
  const prompt = this.buildPrompt(text, attachments);
  await this.acpBackend.sendPrompt(this.acpSessionId, prompt);
}

protected buildPrompt(text: string, attachments?: LocalAttachment[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // 图片放前面（符合多数模型习惯）
  for (const att of attachments ?? []) {
    blocks.push({
      type: 'resource_link',
      uri: `file://${att.localPath}`,
      mimeType: att.mimeType,
    });
  }

  // 保留首条消息标题注入逻辑
  const finalText = this.isFirstMessage
    ? `${text}\n\n${CHANGE_TITLE_INSTRUCTION}`
    : text;
  this.isFirstMessage = false;

  blocks.push({ type: 'text', text: finalText });
  return blocks;
}
```

### 8. Core ACP Backend (`packages/core/src/implementations/agent/acp.ts`)

```typescript
import type { ContentBlock } from '@agentclientprotocol/sdk';

// sendPrompt 参数从 string 改为 ContentBlock[]
async sendPrompt(_sessionId: SessionId, prompt: ContentBlock[]): Promise<void> {
  const promptRequest: PromptRequest = {
    sessionId: this.acpSessionId,
    prompt,  // 直接传，不再硬编码 text 类型
  };
  await withTimeout(this.connection.prompt(promptRequest), 2 * 60_000, 'prompt()');
}
```

同时删除本地 `type ContentBlock = { type: string; text: string }` 定义，改从 SDK 导入。

### 9. `IAgentBackend` (`packages/core/src/interfaces/agent.ts`)

```typescript
import type { ContentBlock } from '@agentclientprotocol/sdk';

export interface IAgentBackend {
  sendPrompt(sessionId: SessionId, prompt: ContentBlock[]): Promise<void>;  // string → ContentBlock[]
  // ...其他不变
}
```

### 10. ClaudeNativeBackend (`apps/free/cli/src/backends/claude-native/ClaudeNativeBackend.ts`)

```typescript
async sendMessage(text: string, permissionMode?: PermissionMode, attachments?: LocalAttachment[]): Promise<void> {
  if (attachments?.length) {
    logger.warn('[ClaudeNativeBackend] image attachments not supported in native mode, sending text only', {
      count: attachments.length,
    });
  }
  // 以下现有逻辑完全不变
}
```

### 11. App — 图片上传 (`apps/free/app/sources/sync/attachmentUpload.ts`) — 新增

```typescript
// 1. copy URI 到持久目录（防 iOS 临时 URI 被回收）
// 2. expo-image-manipulator 压缩：
//    - JPEG 原图 → max 2048px / compress 0.75 / SaveFormat.JPEG
//    - PNG 有透明通道 → max 2048px / SaveFormat.PNG
//    - GIF → 拒绝（提示用户）
// 3. 计算 thumbhash（用于历史消息占位）
//    需要安装 thumbhash 库（当前 package.json 无此依赖，需补装）
// 4. 检查大小（平台差异）：
//    - native: FileSystem.getInfoAsync(uri, { size: true }).size
//    - web:    fetch(uri).then(r => r.blob()).then(b => b.size)
//    - 超 8MB 抛错
// 5. 读为 ArrayBuffer（native: expo-file-system / web: fetch → arrayBuffer）
// 6. socket.emitWithAck('upload-attachment', { sessionId, data, mimeType, filename }, timeout: 30s)
// 7. 返回 AttachmentRef { id, mimeType, thumbhash, filename }

export async function uploadAttachment(
  asset: ImagePickerAsset,
  sessionId: string,
  socket: Socket,
): Promise<AttachmentRef>
```

### 12. App — UI (`apps/free/app/sources/components/AgentInput.tsx`)

新增：
- 输入栏左侧图片按钮（`PhotoIcon`）
- 点击 → `launchImageLibraryAsync({ mediaTypes: 'images', allowsMultipleSelection: true, quality: 1 })`
- 选图后**串行**压缩 + 上传（防并发 OOM）
- 每张图显示 loading 状态 → 上传成功显示缩略图 → × 可移除
- 有任意图片上传中时禁用发送按钮
- 上传失败提示："Daemon 未连接，无法发送图片"
- 切换 session 时取消所有 pending 上传
- App 侧给 `emitWithAck` 设置 30s 客户端超时（独立于 Server 的 15s）

图片显示：
- 当前会话：localUri 在组件 state 里，直接渲染
- 历史消息：消息体里的 `thumbhash` 渲染模糊占位图

### 13. App — `app.config.js`（需 prebuild）

```javascript
infoPlist: {
  NSPhotoLibraryUsageDescription: 'Allow FreeCode to attach images to your messages.',
  // ...现有不变
}
```

### 14. CLI Zod Schema (`apps/free/cli/src/api/types.ts`)

```typescript
const AttachmentRefSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  thumbhash: z.string().optional(),
  filename: z.string().optional(),
});

// UserMessage content 新增
content: z.object({
  type: z.literal('text'),
  text: z.string(),
  attachments: z.array(AttachmentRefSchema).optional(),
}),
```

## File Checklist

| 文件 | 类型 |
|---|---|
| `server/src/app/api/socket.ts` | 修改（maxHttpBufferSize）|
| `server/src/app/api/socket/attachmentHandler.ts` | 新增 |
| `cli/src/daemon/sessions/AgentSession.ts` | 修改 |
| `cli/src/daemon/sessions/AgentBackend.ts` | 修改（LocalAttachment + sendMessage 签名）|
| `cli/src/api/apiSession.ts` | 修改（新增 onFileTransfer 回调）|
| `cli/src/daemon/sessions/cleanAttachments.ts` | 新增 |
| `cli/src/backends/acp/DiscoveredAcpBackendBase.ts` | 修改 |
| `packages/core/src/implementations/agent/acp.ts` | 修改 |
| `packages/core/src/interfaces/agent.ts` | 修改（IAgentBackend.sendPrompt 签名）|
| `cli/src/backends/claude-native/ClaudeNativeBackend.ts` | 修改 |
| `packages/core/src/types/message.ts` | 修改 |
| `cli/src/api/types.ts` | 修改（Zod schema）|
| `app/sources/sync/attachmentUpload.ts` | 新增 |
| `app/sources/components/AgentInput.tsx` | 修改 |
| `app/app.config.js` | 修改（需 prebuild）|

## Edge Cases & Mitigations

| 场景 | 处理方式 |
|---|---|
| Daemon 离线 | ack `{ ok: false, error: 'daemon_offline' }`，App 提示用户 |
| 上传超时（15s）| Server 超时 fallback，同上 |
| App 切后台 WS 暂停 | App 侧 30s 客户端超时独立兜底 |
| 文件 > 8MB（压缩后）| App 侧检查，直接拒绝并提示 |
| mimeType 路径注入 | 白名单映射 `{ 'image/jpeg': 'jpg', 'image/png': 'png', ... }`，非白名单拒绝 |
| Daemon 找不到本地文件（TTL 过期/换机器）| gracefully 跳过附件，只发文字，不崩溃 |
| MessageQueue2 批处理错位 | `onUserMessage` 使用 `pushIsolateAndClear` 保证一对一 |
| PNG 透明通道转 JPEG 丢失 | 按原始格式决定输出格式 |
| GIF 动图 | 拒绝，提示用户 |
| expo-image-picker 返回临时 URI | 先 copy 到 App 持久目录再处理 |
| iOS 相册无多选顺序保证 | 确认 expo-image-picker 返回的 assets[] 顺序与选择顺序一致 |
| 并发上传内存压力 | App 串行压缩 + 上传，单时刻只处理一张 |
| file-transfer 路由到错误 session | 事件携带 sessionId，Daemon 路由到对应 AgentSession |
| session 鉴权 | Server 验证 upload-attachment 的 sessionId 归属当前用户 |
| ClaudeNativeBackend 图片被丢弃 | log warn；App 侧检测 agent 类型，不支持时禁用图片按钮并提示 |
| EXIF 隐私 | 确认 expo-image-manipulator 是否自动剥离 EXIF，必要时显式处理 |

## Pre-Implementation Checklist

- [ ] 实测各 ACP agent（Claude Code、Gemini CLI、OpenCode）对 `resource_link` 的实际行为（是否真正读取文件内容传给模型）
- [ ] 确认 `expo-image-manipulator` 是否自动剥离 EXIF
- [ ] 确认 RN `socket.io-client` 对 `ArrayBuffer` binary 传输的支持情况
- [ ] sandbox 模式下 `~/.free/attachments/` 是否在允许路径内，否则改存 session cwd

