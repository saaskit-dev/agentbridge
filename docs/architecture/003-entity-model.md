# Canonical Entity Model

The system must be modeled around Free-owned entities. These types are canonical product types,
not vendor-native wire types.

## Entity roles

- `Session` is the top-level working context
- `Participant` is the in-session identity
- `Agent` is the runtime-managed execution entity
- `Task` is the work unit
- `Invocation` is the runtime-native execution request
- `Message` is the communication record
- `Artifact` is the work product
- `CapabilitySet` is the structured difference model
- `Event` is the canonical runtime event stream

## Canonical type sketch

```ts
type Timestamp = number;
type Id = string;

type SessionStatus = "active" | "archived";
type ParticipantKind = "user" | "agent" | "system" | "external";
type ParticipantStatus = "active" | "left";
type AgentKind = "claude" | "codex" | "gemini" | "opencode" | "cursor" | (string & {});
type AgentStatus = "idle" | "running" | "unavailable";
type TaskStatus = "pending" | "running" | "blocked" | "completed" | "failed" | "cancelled";
type InvocationStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type MessageKind = "user" | "agent" | "system" | "tool_call" | "tool_result" | "event";
type ArtifactKind = "file" | "patch" | "image" | "summary" | "snapshot" | "other";

type Session = {
  id: Id;
  title: string | null;
  status: SessionStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
  participantIds: Id[];
  activeTaskId: Id | null;
  policy: SessionPolicy;
  summary: SessionSummary | null;
  runtime: SessionRuntimeState | null;
  metadata: Record<string, unknown>;
};

type SessionPolicy = {
  toolApprovalMode: string | null;
  invocationPolicy: string | null;
  sandboxPolicy: string | null;
};

type SessionSummary = {
  short: string;
  updatedAt: Timestamp;
};

type SessionRuntimeState = {
  attachedAgentId: Id | null;
  attachmentStatus: "detached" | "attached" | "switching";
  vendorSessionRef: string | null;
  effectiveCapabilitySetId: Id | null;
};

type Participant = {
  id: Id;
  sessionId: Id;
  kind: ParticipantKind;
  displayName: string;
  status: ParticipantStatus;
  agentId: Id | null;
  joinedAt: Timestamp;
  leftAt: Timestamp | null;
  metadata: Record<string, unknown>;
};

type Agent = {
  id: Id;
  kind: AgentKind;
  displayName: string;
  status: AgentStatus;
  driverId: Id;
  baselineCapabilitySetId: Id;
  metadata: {
    vendor?: string;
    flavor?: string;
    version?: string;
  };
};

type Task = {
  id: Id;
  sessionId: Id;
  parentTaskId: Id | null;
  title: string;
  summary: string | null;
  status: TaskStatus;
  ownerParticipantId: Id | null;
  createdByParticipantId: Id;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  metadata: Record<string, unknown>;
};

type Invocation = {
  id: Id;
  sessionId: Id;
  taskId: Id | null;
  parentInvocationId: Id | null;
  sourceParticipantId: Id;
  targetParticipantId: Id | null;
  targetAgentId: Id | null;
  intent: string;
  capabilityKey: string | null;
  input: CanonicalPayload;
  status: InvocationStatus;
  result: CanonicalPayload | null;
  error: InvocationError | null;
  traceId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type Message = {
  id: Id;
  sessionId: Id;
  taskId: Id | null;
  invocationId: Id | null;
  participantId: Id;
  kind: MessageKind;
  content: CanonicalContent[];
  createdAt: Timestamp;
  metadata: Record<string, unknown>;
};

type CanonicalContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "image"; artifactId: Id }
  | { type: "json"; value: unknown }
  | { type: "reference"; refType: "task" | "invocation" | "artifact"; refId: Id };

type Artifact = {
  id: Id;
  sessionId: Id;
  taskId: Id | null;
  invocationId: Id | null;
  kind: ArtifactKind;
  title: string | null;
  uri: string | null;
  contentRef: string | null;
  mimeType: string | null;
  createdByParticipantId: Id | null;
  createdAt: Timestamp;
  metadata: Record<string, unknown>;
};

type CapabilitySet = {
  id: Id;
  subjectType: "agent" | "session";
  subjectId: Id;
  runtime: RuntimeCapability;
  interaction: InteractionCapability;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

type RuntimeCapability = {
  resumeSession: boolean;
  interrupt: boolean;
  attach: boolean;
  detach: boolean;
  exportSnapshot: boolean;
  switchAgent: {
    supported: boolean;
    reason: string | null;
  };
  invocation: {
    supported: boolean;
    canInvoke: boolean;
    canBeInvoked: boolean;
  };
};

type InteractionCapability = {
  input: {
    text: boolean;
    image: boolean;
  };
  toolCalls: boolean;
  toolApproval: {
    supported: boolean;
    modes: string[];
  };
  reasoningStream: boolean;
  modelSwitch: {
    supported: boolean;
    models: string[];
  };
  modeSwitch: {
    supported: boolean;
    modes: string[];
  };
  configOptions: {
    supported: boolean;
    optionKeys: string[];
  };
  artifacts: boolean;
};

type InvocationError = {
  code: string;
  message: string;
  details: unknown | null;
};

type CanonicalPayload = {
  content: CanonicalContent[];
  metadata: Record<string, unknown>;
};
```

## Relationship rules

- `Session` is Free-owned and must never be treated as a vendor-native session
- `Participant` and `Agent` are separate by design
- `Message` and `Invocation` should be attributed to `Participant`
- `Task` must not be reduced to message metadata
- `Invocation` must not be reduced to tool calls or prompt conventions
- `CapabilitySet` is the only valid way to expose behavioral differences upward
