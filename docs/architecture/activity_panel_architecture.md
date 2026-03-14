# kview Activity Panel Architecture

## Goal

Create a unified operational activity system used by:

-   terminal sessions
-   port‑forward sessions
-   background workers
-   runtime logs

The Activity Panel displays long‑lived operational processes.

### Current State

- **Activities tab**: lists runtime activities from `ActivityRegistry`, including session and runtime/system records.
- **Terminals tab**: surfaces `session type = terminal` backed by `SessionManager`, with lifecycle states (`pending`, `starting`, `running`, `stopping`, `stopped`, `failed`) and tabbed terminal views.
- **Port Forwards tab**: surfaces `session type = portforward`, including live local endpoint metadata and explicit close actions.
- **Logs tab**: shows runtime logs emitted via the runtime log buffer, including launcher/runtime messages and session lifecycle events.

Extension points:

- additional worker/analytics activities beyond current runtime/system events
- richer activity filtering, retention, and projection strategies
