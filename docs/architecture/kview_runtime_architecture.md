# kview Runtime Architecture

## Purpose

This document defines the **runtime foundation** for `kview` so that future long-lived features share one lifecycle model instead of being implemented as isolated systems.

The runtime foundation must support:

- terminal sessions
- port-forward sessions
- background workers
- worker/application logs
- future multi-user evolution

This document is a **design contract** for the AI implementation agent.

---

## Design Goals

1. Keep the current architecture intact:
   - Go backend
   - local HTTP / WebSocket server
   - React frontend
   - browser or webview launcher

2. Introduce a unified backend runtime model for long-lived processes.

3. Make desktop mode work well now, while keeping clear seams for future server / in-cluster mode.

4. Avoid early over-engineering:
   - no Redis yet
   - no broker yet
   - no distributed coordination yet

---

## Core Runtime Model

The runtime layer should treat all long-lived operational processes as **activities**.

### Activity categories

- `session`
  - terminal
  - port-forward
- `worker`
  - analytics poller
  - resource summarizer
  - cache warmer
- `stream`
  - worker logs
  - runtime/system logs

An activity is the top-level unit visible in the Activity Panel.

---

## Main Components

### RuntimeManager

The root coordinator for long-lived runtime features.

Responsibilities:

- hold references to registries and managers
- initialize runtime subsystems during app startup
- expose shared lifecycle hooks
- coordinate shutdown

Suggested responsibilities only; keep it small.

---

### ActivityRegistry

Source of truth for all active runtime entities.

Responsibilities:

- register activity
- update status
- list activities
- lookup by ID
- mark activity as terminated
- remove expired / cleaned-up activity entries

The registry should be in-memory in the first implementation.

---

### SessionManager

Handles interactive or transport-like activities.

Current responsibilities:

- create session records
- track session status using the shared Activity state machine
- terminate sessions explicitly
- mirror sessions into `ActivityRegistry` for visibility in the Activity Panel
- back terminal WebSocket attach logic (for `session type = terminal`)
- manage port-forward session lifecycle (for `session type = portforward`)

Future responsibilities (for additional session types):

- bind session output streams (beyond terminal)
- emit richer session events

Session types:

- terminal session (implemented)
- port-forward session (implemented)

---

### WorkerManager

Handles internal background processes.

Current purpose:

- define the abstraction
- allow registering workers
- allow workers to report status/logs later

Future responsibilities:

- start worker
- stop worker
- restart worker (optional later)
- track heartbeat / last run / last error

---

### LogBus or ActivityEventBus

Lightweight in-process event transport for runtime updates.

Use this only as a local internal mechanism.

Scope:

- activity created
- activity updated
- activity terminated
- worker log line appended
- session state changed

Keep it simple:
- channels
- fan-out subscribers
- no external broker

---

## Lifecycle

### Application Startup

1. Backend config loads.
2. HTTP server initializes.
3. RuntimeManager initializes:
   - ActivityRegistry
   - SessionManager
   - WorkerManager
   - EventBus (optional lightweight implementation)
4. Activity API endpoints are mounted.
5. Frontend starts and can query runtime state.

### Application Shutdown

1. RuntimeManager receives shutdown signal.
2. SessionManager closes active sessions.
3. WorkerManager stops workers.
4. Registry marks activities as terminated.
5. HTTP server exits.

---

## Activity State Model

Suggested common states:

- `pending`
- `starting`
- `running`
- `stopping`
- `stopped`
- `failed`

Optional terminal states:

- `completed`
- `terminated`

Keep state values stable and explicit because frontend will use them.

---

## Data Model Recommendations

### Activity

Common fields:

- `id`
- `kind`
- `type`
- `title`
- `status`
- `createdAt`
- `updatedAt`
- `metadata`

Notes:

- `kind` is broad category: `session`, `worker`, `stream`
- `type` is concrete subtype: `terminal`, `portforward`, `analytics-poller`

### Session

Additional fields:

- `targetCluster`
- `targetNamespace`
- `targetResource`
- `connectionState`
- `ownerMode` (`desktop`, `server`)
- `localEndpoint` (for desktop port-forward later)

### Worker

Additional fields:

- `interval`
- `lastRunAt`
- `lastSuccessAt`
- `lastError`
- `heartbeatAt`

---

## API Contract

Minimum read-only endpoints:

- `GET /api/activity`
- `GET /api/activity/:id` (optional but recommended)

Response should be stable, typed, and frontend-friendly.

Response should remain stable and reusable across UI surfaces.

---

## Eventing Contract (Future-Oriented)

Later the backend may expose runtime activity streams via WebSocket.

Examples:

- `/ws/activity`
- `/ws/activity/:id/logs`

Keep streaming scope narrow and operationally focused.

---

## Desktop vs Future Web Mode

This distinction matters especially for sessions.

### Desktop mode
Backend runs on the user's machine.

Implications:
- port-forward can open local ports on the user's machine
- terminal session is local backend <-> cluster <-> frontend

### Server / in-cluster mode
Backend runs remotely.

Implications:
- "localhost port-forward" semantics change
- session ownership and visibility must become explicit
- runtime entities must not assume single-user desktop forever

Therefore:
- model sessions explicitly now
- do not hardcode desktop-only assumptions in shared interfaces

---

## Runtime Foundation Boundaries

The current runtime foundation includes:

- runtime package scaffolding
- in-memory registry
- activity model and listing API
- `SessionManager` in-memory implementation
- `session type = terminal` wired into ActivityRegistry and Activity Panel
- WebSocket terminal bridge backed by Kubernetes exec
- `session type = portforward` lifecycle and registry integration

Still intentionally **not** implemented yet:

- worker execution engine
- durable storage
- Redis
- NATS / RabbitMQ / Kafka

---

## Future Mapping

### Terminal Enhancements
Will use:
- SessionManager
- ActivityRegistry
- Activity Panel `Terminals` / `Logs`

### Port Forward Enhancements
Will use:
- SessionManager
- ActivityRegistry
- lifecycle-aware cleanup

### Analytics / Worker Runtime
Will use:
- WorkerManager
- ActivityRegistry
- projection store / cache
- Activity Panel `Activities` / `Logs`

---

## Acceptance Criteria for This Architecture

This runtime foundation is acceptable when:

- activity concepts are centralized
- session and worker concepts have clear boundaries
- registry is the source of truth
- terminal and port-forward runtime share one lifecycle model
- desktop mode works without preventing future web deployment
