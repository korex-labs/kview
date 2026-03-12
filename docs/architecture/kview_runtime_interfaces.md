# kview Runtime Interfaces and Contracts

## Purpose

This document defines the suggested Go interfaces for the runtime foundation.

These are **guiding contracts**, not mandatory exact signatures.

The AI implementation agent may adapt naming slightly, but should preserve the architecture.

---

## General Rules

- keep interfaces small
- prefer explicit status transitions
- use `context.Context`
- return typed structs, not generic maps, inside backend code
- keep transport DTOs separate when useful

---

## Activity Model

Suggested core enums / types:

- `ActivityKind`
- `ActivityType`
- `ActivityStatus`

Example values:

- kinds:
  - `session`
  - `worker`
  - `stream`

- types:
  - `terminal`
  - `portforward`
  - `analytics-poller`
  - `runtime-log`

- statuses:
  - `pending`
  - `starting`
  - `running`
  - `stopping`
  - `stopped`
  - `failed`

---

## Suggested Structs

```go
type Activity struct {
    ID        string
    Kind      ActivityKind
    Type      ActivityType
    Title     string
    Status    ActivityStatus
    CreatedAt time.Time
    UpdatedAt time.Time
    Metadata  map[string]string
}
```

Optional extension structs:

```go
type SessionActivity struct {
    Activity
    ConnectionState string
    TargetCluster   string
    TargetNamespace string
    TargetResource  string
}

type WorkerActivity struct {
    Activity
    Interval      time.Duration
    LastRunAt     *time.Time
    LastSuccessAt *time.Time
    LastError     string
    HeartbeatAt   *time.Time
}
```

---

## Activity Registry

```go
type ActivityRegistry interface {
    Register(ctx context.Context, activity Activity) error
    Update(ctx context.Context, activity Activity) error
    Get(ctx context.Context, id string) (Activity, bool, error)
    List(ctx context.Context) ([]Activity, error)
    Remove(ctx context.Context, id string) error
}
```

Notes:
- Phase 1 can use an in-memory implementation
- registry is the source of truth for the Activity Panel

---

## Runtime Manager

```go
type RuntimeManager interface {
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
    Registry() ActivityRegistry
}
```

Notes:
- can be intentionally small in Phase 1
- can later expose WorkerManager / SessionManager accessors if useful

---

## Session Manager

```go
type SessionManager interface {
    List(ctx context.Context) ([]Activity, error)
    Stop(ctx context.Context, id string) error
}
```

Future extension:

```go
type TerminalSessionManager interface {
    SessionManager
    StartTerminal(ctx context.Context, req StartTerminalRequest) (Activity, error)
}

type PortForwardManager interface {
    SessionManager
    StartPortForward(ctx context.Context, req StartPortForwardRequest) (Activity, error)
}
```

Important:
- do not require Phase 1 to implement real start methods yet
- Phase 1 only needs the abstraction seam

---

## Worker Interface

```go
type Worker interface {
    ID() string
    Type() string
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
}
```

Optional richer interface:

```go
type ReportingWorker interface {
    Worker
    Activity() Activity
}
```

---

## Worker Manager

```go
type WorkerManager interface {
    Register(worker Worker) error
    StartAll(ctx context.Context) error
    StopAll(ctx context.Context) error
    List(ctx context.Context) ([]Activity, error)
}
```

Phase 1 can define the interface without executing real workers.

---

## Cache Interface

This is included because analytics and background runtime will need it soon.

```go
type Cache interface {
    Get(ctx context.Context, key string, dest any) (bool, error)
    Set(ctx context.Context, key string, value any, ttl time.Duration) error
    Delete(ctx context.Context, key string) error
}
```

Rules:
- start with in-memory implementation
- keep call sites bound to the interface
- later add Redis-backed implementation without touching service logic

---

## Event Bus (Optional Internal Contract)

```go
type ActivityEvent struct {
    ActivityID string
    Type       string
    Timestamp  time.Time
    Message    string
}

type ActivityEventBus interface {
    Publish(ctx context.Context, event ActivityEvent) error
    Subscribe(ctx context.Context) (<-chan ActivityEvent, func(), error)
}
```

This is useful later for:
- log streaming
- activity updates
- live Activity Panel refresh

Keep it in-process only for now.

---

## HTTP Handler Boundary

HTTP handlers should depend on small interfaces, for example:

```go
type ActivityReader interface {
    List(ctx context.Context) ([]Activity, error)
    Get(ctx context.Context, id string) (Activity, bool, error)
}
```

This prevents handlers from depending on a giant manager object.

---

## WebSocket Boundary

WebSocket handlers should not own session lifecycle.

They should:

- attach to an existing activity or stream
- read/write transport messages
- delegate lifecycle to SessionManager / Runtime components

This rule will matter a lot for terminal implementation.

---

## Desktop vs Remote Safety

For future compatibility:

- do not encode desktop-only assumptions into Activity IDs
- do not assume there is only one user forever
- keep session metadata explicit
- separate UI labels from backend identifiers

---

## Phase 1 Minimum Interface Set

For the first implementation, the minimum useful set is:

- `Activity`
- `ActivityRegistry`
- `RuntimeManager`
- small `ActivityReader` for HTTP handlers

Everything else may be interface-only or placeholder scaffolding.

---

## Acceptance Criteria

These contracts are acceptable when:

- future terminal work can plug into SessionManager without redesign
- future port-forward work can reuse the same activity lifecycle
- worker-based analytics can register visible activities
- the AI agent has clear seams and does not need to improvise architecture
