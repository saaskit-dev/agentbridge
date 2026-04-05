# RFC-013: 端口代理到 App

> Status: Proposed
> Created: 2026-04-05
> Author: AgentBridge Team

## 1. 目标

让运行在用户机器上的本地端口服务可以被 AgentBridge App 访问。

典型场景：

- 本机 `localhost:3000` 的前端 dev server，需要在手机上直接预览
- 本机 `localhost:8080` 的内部管理页，需要从 App 内打开
- 某个 session 里启动的临时 HTTP 服务，需要给当前用户的 App 使用

目标不是做一个通用公网隧道产品，而是在现有 AgentBridge 架构内提供一个“仅当前账号、仅当前机器、默认私有”的远程端口访问能力。

## 2. 现状

当前链路已经具备三块可复用能力：

1. 控制面

- App 已能通过 `apiSocket.machineRPC()` 调用 daemon 侧机器级 RPC
- daemon 已有 `ApiMachineClient` + `RpcHandlerManager`
- App 已有 `machine` 详情页和 `daemonState` 同步

2. 数据面

- CLI 与 server 之间已有稳定的 Socket.IO 长连接
- server 已能在同一用户的多个 socket 之间路由 RPC
- Socket.IO 支持 binary payload，可承载代理流量

3. 本地代理基础

- CLI 已有 [`startHTTPDirectProxy.ts`](/Users/dev/agentbridge/apps/free/cli/src/modules/proxy/startHTTPDirectProxy.ts)
- 现有实现适合本机 HTTP 转发，可作为本地 target 适配层复用

现状缺的不是“能不能通信”，而是缺一套正式的：

- 端口暴露模型
- App/Server/Daemon 间协议
- server 侧 HTTP 入口
- 流量复用与权限控制

## 3. 设计原则

### 3.0 安全优先于易用性

这个功能默认按“高风险本地资源暴露”处理，不按普通便捷功能处理。

设计优先级必须是：

1. 不意外暴露
2. 不扩大访问面
3. 不允许长期失控运行
4. 最后才是使用体验

任何实现如果会把该能力退化成“弱鉴权公网隧道”，都不应接受。

### 3.1 第一阶段只做 HTTP/HTTPS 语义

先支持 HTTP 请求代理，不做原始 TCP 隧道。

原因：

- App 端真实需求大多是打开网页、调用 JSON API、预览 dev server
- server 已是 Fastify，接入 HTTP 代理入口最自然
- 原始 TCP 会显著扩大安全面，且移动端可用性不如 HTTP 明确

WebSocket upgrade 可作为 Phase 2，先不纳入首发范围。

### 3.2 机器级能力，不绑定单个 session

端口服务属于“机器上的资源”，不一定属于某一个 agent session。

所以控制面应挂在 `machineRPC`，而不是 `sessionRPC`：

- `localhost:3000` 这种服务通常独立于 session
- App 已有 machine 详情页，适合展示当前机器的暴露端口
- daemon 已维护 `machine-scoped` socket 和 `daemonState`

### 3.3 数据走 server 中继，不要求 App 直连机器

App 无法稳定直连用户机器，因此必须保持：

`App/WebView -> Free Server HTTPS -> daemon socket -> localhost:port`

这和现有产品形态一致，也便于鉴权和审计。

### 3.4 默认私有、显式开启、可撤销

任何端口代理都必须是显式创建，并默认满足：

- 仅当前登录用户可访问
- 仅 daemon 在线时可访问
- 默认短 TTL
- 可设置过期时间
- 可随时关闭

### 3.5 默认拒绝，显式放行

首版必须坚持 allowlist 思路，而不是“凡是本地端口都能转”：

- 仅允许 `http`
- 仅允许 `127.0.0.1` / `localhost`
- 默认只允许常见开发端口，或至少对非常见端口弹出高风险确认
- 默认拒绝没有 `Content-Type` / `Host` 合理行为的异常流量模式
- 默认不支持匿名访问
- 默认不支持跨账号分享

## 3.6 不信任被代理服务

必须把本地服务当成“不可信 upstream”处理。

这意味着：

- 不能盲转所有 hop-by-hop headers
- 不能信任 upstream 返回的重定向位置
- 不能把 server 自己的认证信息透传给 upstream
- 不能让 upstream 借由代理访问 server 内部路由或 metadata

## 4. 用户体验

### 4.1 核心流程

1. 用户在 App 的 machine 页面点击“Expose Port”
2. 输入：
   - 本地端口，如 `3000`
   - 协议，如 `http`
3. App 通过 `machineRPC` 请求 daemon 开放这个端口
4. daemon 校验本地端口可达，并将该端口加入开放端口表
5. daemon 将开放端口状态写入 `daemonState.portProxies`
6. App 在 machine 页展示开放端口列表
7. 用户点击后，在 App 内通过 server URL 打开：

```text
https://free-server.example.com/v1/port-proxy/{machineId}/{port}/
```

### 4.2 关闭流程

1. App 点击“Stop Proxy”
2. App 调用 `machineRPC(machineId, 'stop-port-proxy', { port })`
3. daemon 关闭本地代理状态并更新 `daemonState`
4. server 立即拒绝后续请求

## 5. 架构

### 5.1 控制面

控制面沿用现有 `machineRPC`：

- App -> `apiSocket.machineRPC()`
- server -> `rpcHandler`
- daemon -> `ApiMachineClient.rpcHandlerManager`

新增 RPC：

- `start-port-proxy`
- `stop-port-proxy`
- `list-port-proxies`

### 5.2 数据面

数据面新增一条 server HTTP 入口：

```text
App/WebView
  -> GET/POST /v1/port-proxy/:machineId/:port/*
  -> server 校验 machine owner + port 已开放
  -> server 通过 machine RPC/stream 把请求转给 daemon
  -> daemon 请求 localhost:port
  -> daemon 把响应流回 server
  -> server 回给 App/WebView
```

### 5.3 为什么不让 App 直接 machineRPC 拉页面内容

因为页面不是一个单次 RPC：

- HTML 只是第一个请求
- 页面会继续加载 JS/CSS/image/XHR
- 需要一个稳定的 URL origin，方便 WebView/浏览器继续请求资源

所以必须是 server 提供 HTTP origin，daemon 只负责作为 upstream。

## 6. 数据模型

不新增顶层持久对象，首版放入 `daemonState` 即可。

这里需要区分两类状态：

- `daemonState.portProxies`
  - 供 App/UI 展示
  - 非实时授权依据
- daemon/server runtime registry
  - 供真实请求路由和授权判断
  - 是实时权威源

在 CLI 侧 [`apps/free/cli/src/api/types.ts`](/Users/dev/agentbridge/apps/free/cli/src/api/types.ts) 的 `DaemonStateSchema` 中扩展：

```ts
portProxies?: Array<{
  protocol: 'http';
  targetHost: '127.0.0.1' | 'localhost';
  targetPort: number;
  status: 'starting' | 'active' | 'error' | 'stopped';
  createdAt: number;
  lastActiveAt?: number;
  lastError?: string;
  expiresAt?: number;
}>
```

App 侧 [`apps/free/app/sources/sync/storageTypes.ts`](/Users/dev/agentbridge/apps/free/app/sources/sync/storageTypes.ts) 需要同步这部分类型。

为什么先放 `daemonState`：

- 这是机器运行时能力，生命周期跟 daemon 在线状态一致
- App 已经实时同步 `daemonState`
- 首版不需要数据库持久化，避免 server schema 变更

如果后续需要“daemon 重启后恢复代理配置”，再升级为 DB 持久化配置 + daemon 恢复。

### 6.1 唯一性语义

首版明确规定：

- 同一 `machineId` 下，`targetPort` 是唯一 key
- 不支持同一端口挂多个规则
- 不支持 path-based multiplexing
- 不支持同端口多 session 竞争暴露

这意味着首版的开放模型是：

```ts
machineId + targetPort -> exactly one open-port record
```

后续如果需要同端口多规则，再引入内部记录 ID；但首版不预埋到外部 URL。

## 7. 协议设计

### 7.1 Machine RPC

#### `start-port-proxy`

请求：

```ts
{
  protocol: 'http';
  targetPort: number;
  targetHost?: '127.0.0.1' | 'localhost';
  expiresInMs?: number;
}
```

响应：

```ts
{
  portProxy: {
    protocol: 'http';
    targetPort: number;
    targetHost: '127.0.0.1' | 'localhost';
    status: 'active';
    createdAt: number;
    expiresAt?: number;
    publicPath: string;
  };
}
```

daemon 行为：

1. 参数校验
2. 探测本地端口是否可连接
3. 在内存开放端口表中注册 `targetPort`
4. 更新 `daemonState.portProxies`
5. 向 server runtime registry 注册该开放端口

#### `stop-port-proxy`

请求：

```ts
{ port: number }
```

响应：

```ts
{ ok: true }
```

#### `list-port-proxies`

请求：

```ts
{}
```

响应：

```ts
{ proxies: Array<...> }
```

### 7.2 Server <-> Daemon 流量协议

这里不建议复用传统 `rpc-call` 单包模型，原因是 HTTP body/response 可能较大，且需要流式。

建议新增一组专用 socket 事件：

- `proxy:http-request-open`
- `proxy:http-request-chunk`
- `proxy:http-request-end`
- `proxy:http-response-head`
- `proxy:http-response-chunk`
- `proxy:http-response-end`
- `proxy:http-abort`

核心字段：

```ts
type ProxyRequestOpen = {
  requestId: string;
  machineId: string;
  port: number;
  method: string;
  path: string;
  query?: string;
  headers: Record<string, string>;
  startedAt: number;
};
```

```ts
type ProxyResponseHead = {
  requestId: string;
  status: number;
  headers: Record<string, string>;
};
```

说明：

- `requestId` 由 server 生成，用于多路复用
- body 按 chunk 发送，binary 直接走 Socket.IO binary
- server 只负责转发，不解读业务内容

补充约束：

- 每个 chunk 必须带递增 `seq`
- 首版 chunk 大小固定上限，建议 64KB
- `response-head` 之后若 daemon 断连，server 必须主动结束 HTTP response
- 任一端收到 `proxy:http-abort` 后必须停止继续发送 chunk
- 同一 `requestId` 的事件必须按 `open -> chunk* -> end` 和 `head -> chunk* -> end` 顺序处理

建议补充事件体：

```ts
type ProxyBodyChunk = {
  requestId: string;
  seq: number;
  data: Buffer;
};
```

### 7.3 背压与取消

首版不要求实现复杂的信用窗口协议，但必须定义最小行为：

- server 到 daemon 的转发使用 Node stream pause/resume 或等价机制
- 当下游不可写时，暂停继续读取上游 body
- 客户端断开 HTTP 请求时，server 立即发送 `proxy:http-abort`
- daemon 本地 upstream 中断时，立即发送响应结束或错误结束信号

如果实现阶段发现 Socket.IO 事件模型不足以稳定承载背压，需要收缩到“首版仅支持小体积请求/响应，不支持真正 streaming HTML”。

## 8. Daemon 侧实现

### 8.1 新模块

建议新增：

- `apps/free/cli/src/modules/proxy/PortProxyRegistry.ts`
- `apps/free/cli/src/modules/proxy/HttpProxyStream.ts`
- `apps/free/cli/src/modules/proxy/types.ts`

职责：

- `PortProxyRegistry`
  - 管理当前机器所有已开放端口
  - 校验重复端口暴露
  - 维护 `port -> target`
  - 对外提供 `openRequest(requestId, port, reqMeta)`
  - 负责 TTL 过期回收
  - 负责在端口过期/关闭时同步更新 `daemonState`

- `HttpProxyStream`
  - 把一个 server 转发来的 HTTP 请求桥接到 `localhost:port`
  - 负责 request/response 流式转发

### 8.2 ApiMachineClient

在 [`apps/free/cli/src/api/apiMachine.ts`](/Users/dev/agentbridge/apps/free/cli/src/api/apiMachine.ts)：

- 注册 `start-port-proxy`
- 注册 `stop-port-proxy`
- 注册 `list-port-proxies`
- socket connect 后注册 proxy stream 事件处理器
- 在开放端口状态变化时调用 `updateDaemonState()`

### 8.2.1 TTL 权威源

TTL 以 daemon 本地 registry 为权威源：

- daemon 定时检查开放端口是否过期
- 过期后先从本地 registry 删除
- 再通知 server runtime registry 删除
- 最后更新 `daemonState.portProxies`

server 侧 TTL 清理仅作为兜底，不作为主状态源。

### 8.3 端口访问策略

daemon 只允许连接：

- `127.0.0.1`
- `localhost`

首版明确禁止：

- 任意局域网 IP
- 任意公网 IP
- Unix socket

这样可以把能力严格限制为“暴露本机 localhost 服务”，安全边界清晰。

## 9. Server 侧实现

### 9.1 HTTP 路由

新增：

- `apps/free/server/src/app/api/routes/portProxyRoutes.ts`

注册后提供：

```text
GET     /v1/port-proxy/:machineId/:port/*
POST    /v1/port-proxy/:machineId/:port/*
PUT     /v1/port-proxy/:machineId/:port/*
PATCH   /v1/port-proxy/:machineId/:port/*
DELETE  /v1/port-proxy/:machineId/:port/*
HEAD    /v1/port-proxy/:machineId/:port/*
OPTIONS /v1/port-proxy/:machineId/:port/*
```

server 行为：

1. 校验用户登录
2. 校验 `machineId` 属于当前用户
3. 校验该 `port` 已被该机器显式开放
4. 确认该用户当前有在线的 machine-scoped socket
5. 建立一次 `requestId`
6. 将 HTTP 请求流经 socket 转给 daemon
7. 把 daemon 返回的 status/header/body 写回 HTTP response

### 9.2 Port Registry

server 需要一个运行时 registry：

```ts
Map<string, Map<number, { userId: string; socketId: string; expiresAt?: number }>>
```

其中第一层 key 是 `machineId`，第二层 key 是 `port`。

它只保存在线开放端口：

- daemon 开放端口时注册
- daemon 下线时批量清理
- 端口过期时清理

这意味着首版代理天然是“在线能力”，符合产品预期。

### 9.2.1 权威状态源

这里必须明确：

- 实时授权与路由只看 server runtime registry
- `daemonState.portProxies` 不参与请求放行判断
- `daemonState.portProxies` 只用于 App/UI 展示

原因：

- `daemonState` 是异步同步，不保证实时一致
- runtime registry 才能跟 socket 在线状态严格绑定

### 9.3 鉴权

首版只允许已登录用户访问自己的代理 URL。

不做匿名分享链接，不做公开访问。

也就是说 `portProxyRoutes` 必须走 `app.authenticate`。

这样 App 内 WebView 或 App 自己的请求可以稳定工作，且不引入额外 token 模型。

### 9.4 请求头与响应头净化

server 和 daemon 都必须做 header filtering。

请求侧至少移除：

- `authorization`
- `cookie`
- `x-forwarded-*`
- `connection`
- `keep-alive`
- `proxy-authenticate`
- `proxy-authorization`
- `te`
- `trailer`
- `transfer-encoding`
- `upgrade`

请求侧处理策略补充：

- upstream `Host` 重写为 `127.0.0.1:${port}` 或 `localhost:${port}`
- `Origin` 默认剥离；如果 dev server 必须依赖，可在后续加入受控改写
- `Referer` 默认剥离
- 不透传 App 对 server 的 session cookie

并由 server 重新设置：

- `x-agentbridge-user-id`
- `x-agentbridge-machine-id`
- `x-agentbridge-target-port`

响应侧至少移除：

- `set-cookie`
- `connection`
- `keep-alive`
- `proxy-authenticate`
- `proxy-authorization`
- `te`
- `trailer`
- `transfer-encoding`
- `upgrade`

如果 upstream 返回 `Location`，必须重写为当前 `machineId + port` 路径下的相对或代理后 URL，不能把用户重定向到裸 `localhost`。

响应侧策略补充：

- 不覆盖 upstream 正常的 `content-type`
- 对 HTML 响应可后续追加受控 CSP，但首版不强制注入
- CORS 不由 server 额外放宽；优先让 WebView 同源访问解决资源加载问题

### 9.5 资源限制

首版至少需要：

- 单请求总时长上限
- 空闲超时
- 单响应体大小上限
- 单账号并发代理请求数上限
- 单开放端口并发请求数上限

建议默认值：

- 请求超时：30s
- 空闲超时：15s
- 响应体限制：10MB
- 单账号并发：20
- 单开放端口并发：6

超过限制直接终止，并写 telemetry。

## 10. App 侧实现

### 10.1 状态消费

App 只消费 `machine.daemonState.portProxies`，不需要独立 sync 通道。

### 10.2 入口位置

建议放在 machine 页面 [`apps/free/app/sources/app/(app)/machine/[id].tsx`](/Users/dev/agentbridge/apps/free/app/sources/app/(app)/machine/[id].tsx)：

- 新增一个 `Port Proxies` 分组
- 展示当前已开放端口
- 提供“开放端口”按钮

### 10.3 打开方式

App 端点击开放端口后，使用 server URL 打开：

```ts
${serverConfig.baseUrl}/v1/port-proxy/${machineId}/${port}/
```

对于 HTML 页面，优先在内置 WebView 打开。

对于纯 API，可直接由 App fetch。

## 11. 安全

### 11.1 明确风险

这个功能本质上是在“把本机 localhost 服务带到远端设备上”。

风险主要在：

- 用户误暴露了只应本地访问的敏感服务
- 被代理的页面可能拥有危险接口
- 长连接代理可能被滥用造成资源压力
- 代理链路可能被利用做 SSRF / header smuggling / cookie 注入
- upstream 可能返回恶意 HTML/JS，诱导用户在 App WebView 内执行危险操作

### 11.2 首版安全边界

首版强制：

- 仅认证用户本人可访问
- 仅 `localhost/127.0.0.1`
- 仅 HTTP
- 默认短 TTL，建议 30 分钟，最长不超过 24 小时
- daemon 离线即不可访问
- App UI 明确展示“正在暴露本机端口”
- App UI 明确展示目标端口，避免用户不知道自己暴露了什么
- 必须先显式开放端口，不能按 URL 自动探测本地端口
- header 白名单/黑名单过滤
- 重定向重写
- 请求大小、响应大小、并发、超时限制
- 所有创建/访问/关闭行为打 telemetry 审计日志

### 11.3 后续可加

- 每个开放端口的请求速率限制
- 响应体大小限制
- 访问日志
- 二次确认名单，例如对 `3000/5173/8080` 之外端口弹警告
- 风险端口 denylist，例如数据库、Docker、Kubernetes、本地云元数据模拟器等
- 代理访问确认页，首次打开前再次提示

### 11.4 首版必须明确不支持

为了收紧攻击面，以下内容首版明确不支持：

- 原始 TCP
- UDP
- 匿名分享链接
- 跨账号协作访问
- 自定义远程目标主机
- 持久后台常驻公开代理
- 透传 cookie / auth header
- 非 HTTP upgrade 的复杂隧道协议

### 11.5 端口风险策略

建议增加端口风险分层：

- 低风险：`3000`, `4173`, `5173`, `8000`, `8080`, `8787`
- 中风险：其他常见 web 端口
- 高风险：`22`, `2375`, `2376`, `5432`, `6379`, `27017`, `6443`, `9200`

策略：

- 低风险端口可直接创建
- 中风险端口需要二次确认
- 高风险端口首版直接拒绝

即便这些服务运行在 localhost，上述高风险端口依然不应被手机端桥接。

### 11.6 Telemetry 与审计

必须使用统一 Logger，至少记录：

- 端口开放
- 端口关闭
- 端口过期
- 请求开始
- 请求结束
- 超时/超限/鉴权失败
- upstream 连接失败

日志字段至少包含：

- `userId`
- `machineId`
- `targetPort`
- `requestId`
- `statusCode`
- `durationMs`
- `bytesIn`
- `bytesOut`

禁止记录完整 body；header 也应做脱敏。

## 12. 实施顺序

### Phase 1

- 扩展 `DaemonStateSchema`
- daemon 增加 `start-port-proxy / stop-port-proxy / list-port-proxies`
- App machine 页展示开放端口列表

这一步完成后，控制面已经跑通，但还不能真正转发 HTTP。

注意：

- Phase 1 不承诺 `publicPath` 可立即访问
- `publicPath` 仅在 Phase 2 server 路由打通后才可视为正式能力

### Phase 2

- server 增加 `portProxyRoutes.ts`
- CLI/server 新增 proxy stream socket 事件
- 完成单请求 HTTP 转发

### Phase 3

- 支持 streaming body
- 支持大响应
- 支持断开清理、TTL、错误态回写

### Phase 4

- 可选支持 WebSocket upgrade
- 可选持久化代理配置

## 13. 关键文件落点

CLI:

- [`apps/free/cli/src/api/apiMachine.ts`](/Users/dev/agentbridge/apps/free/cli/src/api/apiMachine.ts)
- [`apps/free/cli/src/api/types.ts`](/Users/dev/agentbridge/apps/free/cli/src/api/types.ts)
- [`apps/free/cli/src/modules/proxy/startHTTPDirectProxy.ts`](/Users/dev/agentbridge/apps/free/cli/src/modules/proxy/startHTTPDirectProxy.ts)
- `apps/free/cli/src/modules/proxy/PortProxyRegistry.ts`
- `apps/free/cli/src/modules/proxy/HttpProxyStream.ts`

Server:

- [`apps/free/server/src/app/api/api.ts`](/Users/dev/agentbridge/apps/free/server/src/app/api/api.ts)
- `apps/free/server/src/app/api/routes/portProxyRoutes.ts`
- [`apps/free/server/src/app/api/socket.ts`](/Users/dev/agentbridge/apps/free/server/src/app/api/socket.ts)
- [`apps/free/server/src/app/api/socket/rpcHandler.ts`](/Users/dev/agentbridge/apps/free/server/src/app/api/socket/rpcHandler.ts)

App:

- [`apps/free/app/sources/app/(app)/machine/[id].tsx`](/Users/dev/agentbridge/apps/free/app/sources/app/(app)/machine/[id].tsx)
- [`apps/free/app/sources/sync/storageTypes.ts`](/Users/dev/agentbridge/apps/free/app/sources/sync/storageTypes.ts)
- [`apps/free/app/sources/sync/ops.ts`](/Users/dev/agentbridge/apps/free/app/sources/sync/ops.ts)

## 14. 决策总结

这个功能应该做成：

- 机器级能力，不是 session 级
- 首发只支持 HTTP，不做原始 TCP
- App 通过 server URL 访问，不直连 daemon
- 在线状态放 `daemonState.portProxies`
- 控制面走 `machineRPC`
- 数据面走新的 socket 流式代理事件
- 路由采用 `/v1/port-proxy/:machineId/:port/*`
- 登录态负责鉴权，`machineId + port` 负责寻址，开放端口表负责授权

这是和当前代码库最一致、改动面最可控、同时能真正解决“手机访问本机端口”问题的方案。
