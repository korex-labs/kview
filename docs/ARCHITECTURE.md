# Architecture

This document states **core architectural rules** for kview. It guides developers and tooling; treat it as a contract alongside the code.

---

## Product shape

kview is a **local, single-binary** application: Go backend embeds the React UI (`go:embed`). No external services are required for normal operation.

---

## Local-first

The API and UI run in-process. Cluster access uses the operator’s kubeconfig and respects **Kubernetes RBAC** end to end.

---

## View-first UI

The product prioritizes **resource visibility** (inspection, debugging, operational clarity) over batch automation. See [UI_UX_GUIDE.md](UI_UX_GUIDE.md) for UI contracts.

---

## Drawer-based exploration

Lists stay visible while a **drawer** shows resource context. Navigation is list → row → drawer, with cross-resource links opening further drawers.

---

## Backend (summary)

- HTTP API (chi), embedded static UI
- `client-go` for Kubernetes
- Generic mutations: `POST /api/actions` via a central **ActionRegistry**
- Capability detection: `POST /api/capabilities` and read access checks via `POST /api/auth/can-i`
- **Read-side dataplane** under `internal/dataplane`: snapshots, scheduler, observers, projections (see [DATAPLANE.md](DATAPLANE.md))
- **Runtime**: activities, sessions, terminals, port-forwards, structured logs

---

## Frontend (summary)

- React, Vite, TypeScript, MUI
- Shared components, **design tokens** for spacing/typography/color (avoid one-off inline styling where tokens exist)
- Capability-aware action rendering

---

## Reusable components

Repeated UI patterns should be **extracted** (tables, drawers, mutation dialogs, resource chrome). Avoid copy-paste implementations.

---

## Action framework

All mutations go through **`POST /api/actions`**. Handlers register verbs on the ActionRegistry; the UI discovers allowed actions via capability checks.

---

## RBAC awareness

The UI must not surface actions the cluster forbids. Use `POST /api/capabilities` for resource actions and `POST /api/auth/can-i` for targeted read/access checks; show denial reasons when useful.

---

## Activity runtime

Long-running work (terminals, port-forwards, Helm, etc.) integrates with the **activity runtime** so operators see status and logs in the Activity Panel.

---

## Observability

Prefer **clear** errors, activity timeline, and runtime logs for operator visibility. Dataplane-backed list APIs expose **snapshot metadata** (`freshness`, `coverage`, `degradation`, `completeness`, `state`) so the UI can be honest about data quality.

---

## Read path: dataplane vs handler

- **Dataplane** owns scheduler-mediated **list snapshots** and **projections** built only from those snapshots (no hidden live kube calls inside projection builders).
- **Handlers** use snapshots/projections for the surfaces documented in [API_READ_OWNERSHIP.md](API_READ_OWNERSHIP.md).
- **Direct `kube` reads** in handlers are **intentional exceptions** (detail, events, YAML, relations, selected namespace helpers, cluster-scoped APIs, Helm chart catalog, etc.). Keep them obvious in `internal/server/server.go`.

When you add or change a user-facing **GET** (or read-shaped) route under `/api`, update **API_READ_OWNERSHIP.md** in the same change.

---

## Maintainability

Favor readable code, explicit boundaries, and minimal duplication. Documentation should describe **current behavior**, not migration history.
