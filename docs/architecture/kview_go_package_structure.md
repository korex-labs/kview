# kview Suggested Go Package Structure

## Purpose

This document proposes a package layout for `kview` that is:

- easy for AI agents to reason about
- aligned with current architecture
- scalable for terminal / port-forward / analytics work
- conservative enough to avoid premature complexity

This is a **recommended target structure**, not a demand to rewrite everything immediately.

---

## Principles

1. Prefer small, clear packages over giant utility packages.
2. Keep transport layers separate from runtime/domain logic.
3. Keep Kubernetes integration separate from activity/runtime orchestration.
4. Introduce seams first; migrate incrementally.
5. Do not move working code without need.

---

## Recommended Layout

```text
cmd/
  kview/
    main.go

internal/
  app/
    app.go
    config.go
    bootstrap.go

  launcher/
    mode.go
    browser.go
    webview.go

  api/
    router.go
    middleware.go

  apihttp/
    activity_handler.go
    settings_handler.go

  stream/
    logs_ws.go
    activity_ws.go

  runtime/
    manager.go
    activity.go
    registry.go
    events.go

  session/
    manager.go
    session.go
    types.go

  worker/
    manager.go
    worker.go
    registry.go

  cache/
    cache.go
    memory.go

  kube/
    client.go
    config.go
    discovery.go
    resources.go

  analytics/
    summary.go
    projections.go

  settings/
    settings.go
    theme.go

  uiassets/
    embed.go
```

---

## Package Intent

### `internal/app`
Application bootstrap and wiring.

Put here:
- config loading
- initialization sequence
- top-level dependency assembly

Avoid putting business logic here.

---

### `internal/launcher`
Launcher-specific behavior.

Put here:
- browser launch
- webview launch
- launch mode parsing

Keep this package thin.

---

### `internal/api`
Shared HTTP router setup and cross-cutting transport setup.

Put here:
- route registration
- common middleware
- transport bootstrap

---

### `internal/apihttp`
Concrete HTTP handlers.

Good for:
- REST-like handlers
- JSON response shaping
- binding request/response DTOs

This keeps handlers separate from runtime logic.

---

### `internal/stream`
WebSocket or stream-oriented transport handlers.

Existing log streaming naturally fits here.

Future:
- activity streams
- terminal streams

Keep stream transport separate from session/runtime domain logic.

---

### `internal/runtime`
Shared operational runtime model.

Put here:
- Activity type
- ActivityRegistry
- RuntimeManager
- event model

This should become the backbone for all long-lived features.

---

### `internal/session`
Interactive or transport sessions.

Put here:
- session abstractions
- session manager
- session typing

Future features:
- terminal
- port-forward

Do not mix HTTP handlers directly into this package.

---

### `internal/worker`
Background task abstractions.

Put here:
- worker interface
- worker manager
- worker state tracking

This keeps analytics polling and cache refresh features out of generic runtime code.

---

### `internal/cache`
Cache abstractions.

Put here:
- cache interface
- in-memory implementation
- later Redis implementation

Important:
- keep the interface narrow
- do not bind the whole app directly to a vendor library

---

### `internal/kube`
Kubernetes integration.

Put here:
- Kubernetes clients
- discovery
- resource access helpers
- informer/watch support later

This package should not own Activity lifecycle logic.

---

### `internal/analytics`
Derived summaries and projections.

Future package for:
- namespace summaries
- dashboard-ready aggregated data
- expensive computed views

This package can consume data from `kube`, `cache`, and `worker`.

---

### `internal/settings`
App settings and theme state.

Put here:
- theme mode
- preference structures
- persistence later if needed

---

## Frontend Alignment

The backend package structure should map cleanly to frontend concepts:

- `runtime` -> Activity Panel
- `session` -> Sessions tab
- `worker` -> Activities / Logs tab
- `settings` -> theme and app settings
- `kube` -> cluster/resource views

---

## Incremental Migration Strategy

Do not refactor the whole project at once.

Recommended approach:

1. Add new packages for Phase 1:
   - `runtime`
   - `launcher`
   - maybe `settings`
2. Wire new code into existing app structure.
3. Migrate only the code touched by the current phase.
4. Leave unrelated working code in place.

---

## Anti-Patterns to Avoid

Avoid these:

- giant `utils` packages
- mixing HTTP handlers with Kubernetes client logic
- putting session lifecycle in WebSocket handlers
- binding runtime state to frontend transport code
- implementing terminal and port-forward as unrelated one-off packages

---

## Minimum Package Additions for Phase 1

If you want the smallest useful first step, add only:

```text
internal/launcher/
internal/runtime/
internal/settings/   (optional but recommended)
```

This is enough to support:
- browser/webview/server launch modes
- activity registry foundation
- theme-related backend settings scaffolding if needed

---

## Acceptance Criteria

This structure is acceptable when:

- new long-lived features have obvious homes
- transport code is separated from runtime logic
- Kubernetes resource access remains decoupled from session/workflow logic
- future AI agents can implement features without inventing new architecture each time
