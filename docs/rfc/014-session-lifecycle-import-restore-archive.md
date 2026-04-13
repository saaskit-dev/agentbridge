# RFC-014: Session 生命周期语义统一

- **Status**: Implemented ✅
- **Created**: 2026-04-11
- **Last Updated**: 2026-04-11

## 1. 目标

统一以下三个用户动作的语义、边界和实现分层，避免后续各层各自发明一套“继续会话”逻辑：

1. 导入已有 agent session
2. 恢复已归档的 managed session
3. 归档当前 managed session

本文档是产品语义和工程实现的当前真相来源。

## 2. 术语

### 2.1 External Session

上游 agent 自己管理的 session，AgentBridge 尚未托管。

例子：
- Claude / Codex / OpenCode / Gemini / Cursor 历史会话列表中的一条记录

### 2.2 Managed Session

AgentBridge 已托管的 session，拥有自己的 `sessionId`、消息存储、权限状态和实时同步。

### 2.3 Managed Session 状态

- `active`
  - daemon 正在托管，或最近仍在线
- `offline`
  - managed session 存在，但 daemon 暂时不在线，允许 daemon 恢复接管
- `archived`
  - managed session 已被显式结束；历史保留，但不再被视为活跃会话
- `deleted`
  - 物理删除，不可恢复

## 3. 语义规则

### 3.1 导入

导入的语义是：

`external session -> new managed session`

关键点：

- 导入不会复用旧的 AgentBridge `sessionId`
- 导入依赖上游 `resumeAgentSessionId`
- 导入成功后，AgentBridge 会创建一个新的 managed session，并记录上游 session id 以便去重

### 3.2 恢复

恢复的语义是：

`archived managed session -> same managed session reactivated`

关键点：

- 恢复必须复用原 `sessionId`
- 恢复必须显式从 `archived` 切回 `active`
- 恢复不是“新建一个差不多的会话”，而是重新激活同一个 managed session
- 恢复仍依赖上游 `resumeAgentSessionId` 来恢复 agent 自身上下文

### 3.3 归档

归档的语义是：

`active/offline managed session -> archived managed session`

关键点：

- 归档会结束 daemon 托管
- 归档会保留历史消息、metadata、usage、附件关联等 managed session 数据
- 归档后 session 不再出现在 active session 视图里，但仍可在历史中查看

## 4. 分层职责

### 4.1 App

App 负责：

- 决定用户当前是在“导入”还是“恢复”
- 收集 resume 所需参数
- 发起统一 resume 动作
- 处理目录不存在确认、错误弹窗、导航

App 不负责：

- 直接改写服务端 session 状态
- 决定 daemon 如何恢复 agent 上下文

### 4.2 Daemon / CLI

daemon 负责：

- 将 resume 请求转换成 managed session 初始化
- 在“导入”和“恢复”两种模式下，统一走 agent resume 流程
- 在恢复模式下显式调用服务端 restore API，而不是普通 create/reuse API

daemon 不负责：

- 重新定义产品语义上的“导入”或“恢复”

### 4.3 Server

server 负责：

- `POST /v1/sessions`
  - 仅用于创建新 managed session，或重新接管 `active/offline` session
- `POST /v1/sessions/:sessionId/restore`
  - 专用于 `archived -> active`
- `PATCH /v1/sessions/:sessionId/archive`
  - HTTP 归档后备路径
- `session-end` socket 事件
  - 正常归档主路径

server 不负责：

- 枚举 external session
- 调用上游 agent 的 resume API

## 5. 当前统一实现

### 5.1 App 统一入口

App 侧统一入口是：

- `resumeIntoManagedSession()`

参数语义：

- `resumeAgentSessionId`
  - 上游 agent session id，导入和恢复都必须提供
- `targetSessionId?`
  - 缺省：导入
  - 有值：恢复同一个 managed session

规则：

- `targetSessionId` 为空时，`restoreSession=false`
- `targetSessionId` 存在时，`restoreSession=true`

### 5.2 Daemon 统一入口

daemon 侧统一入口仍是 spawn session，但有两种模式：

- 普通 resume 模式
  - external session 导入
- restore mode
  - archived managed session 恢复

`restoreSession=true` 时：

- `AgentSession.initialize()` 调用 `api.restoreSession()`
- 不再调用 `api.getOrCreateSession()`

### 5.3 Server 状态机

```text
create/import:
  external -> POST /v1/sessions -> managed(active/offline path)

archive:
  managed(active/offline) -> session-end or PATCH archive -> archived

restore:
  managed(archived) -> POST /v1/sessions/:id/restore -> active
```

## 6. 为什么恢复不能复用 create 路径

恢复如果偷偷混在 `POST /v1/sessions` 里，会造成三个问题：

1. `archived` 不再是显式终态，边界变模糊
2. create/reuse/restore 三种语义混在一起，不利于审计和测试
3. App 本地将 `archived` 视为终态，keepalive 不会自动把它改回 active，必须显式广播 `update-session(active)`

因此当前规则是：

- create/reuse 只处理 `active/offline`
- restore 单独处理 `archived`

## 7. 为什么导入和恢复要共享 App helper

导入和恢复虽然是不同的产品动作，但它们共享同一组交互细节：

- resume 参数拼装
- 目录缺失确认
- `resume_failed` 错误提示
- 成功后导航

如果各自维护一套，最容易出现：

- 一边传了 `model/mode/permissionMode`，另一边漏传
- 一边支持目录自动确认，另一边不支持
- 一边更新错误文案，另一边漂移

所以当前规定：

- App 入口允许分开
- App 实现必须共享同一个 resume helper

## 8. 数据不变量

以下不变量必须长期成立：

1. `archived` session 不能通过 `POST /v1/sessions` 被隐式恢复
2. 恢复必须复用原 `sessionId`
3. 恢复必须广播显式的 `active` 状态更新
4. 导入不得占用已有 managed session 的 `sessionId`
5. `deleted` 是终态，不可恢复

## 9. 当前测试覆盖

当前已有测试覆盖以下关键断言：

- App helper
  - 导入成功
  - 恢复时 `restoreSession=true`
  - 目录不存在确认重试
  - `resume_failed` / 普通错误分支
- Server route
  - `POST /v1/sessions` 遇到 `archived` 返回 `409`
  - `POST /v1/sessions/:id/restore` 成功恢复
  - restore 目标不存在返回 `404`
- Daemon / CLI
  - `restoreSession=true` 时，`AgentSession.initialize()` 走 `api.restoreSession()`
  - 不回退到 `api.getOrCreateSession()`

## 10. 后续约束

后续如果再新增“继续会话”相关能力，必须先回答以下问题：

1. 它作用于 `external session` 还是 `managed session`？
2. 它是否复用原 `sessionId`？
3. 它是否需要显式生命周期状态切换？
4. 它应该落在 create、restore、还是 archive 语义里？

如果这四个问题答不清楚，不允许直接扩展实现。
