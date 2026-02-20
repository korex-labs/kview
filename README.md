# kview

kview is a local, single-binary, view-first Kubernetes UI inspired by tools like Lens and k9s.

It embeds a React + MUI frontend inside a Go backend and runs as a standalone binary.
The focus is operational clarity, consistency, and cross-resource navigation.

---

## Philosophy

- Local-first
- View-first (power-user ready)
- Strict RBAC awareness
- Deep cross-resource linking
- Clean, consistent UI contract

---

## Architecture

Backend:
- Go (chi, client-go)
- Embedded UI via go:embed
- Generic mutation endpoint (`/api/actions`)
- Centralized ActionRegistry
- RBAC-aware capabilities endpoint (`/api/capabilities`)
- Shared mutation helpers (namespaced + cluster-scoped)

Frontend:
- React + Vite + MUI
- Drawer-based UX
- Metadata-driven mutation framework
- Shared ActionButton + MutationDialog
- Capability-aware rendering via `useResourceCapabilities`

---

## Supported Resources

Workloads:
- Pods
- Deployments
- ReplicaSets (derived via Deployments)
- StatefulSets
- DaemonSets
- Jobs
- CronJobs

Networking:
- Services
- Ingresses

Storage:
- PVCs
- PVs

Configuration:
- ConfigMaps
- Secrets

Access Control:
- Roles
- RoleBindings
- ClusterRoles
- ClusterRoleBindings

Cluster:
- Nodes
- Namespaces
- ResourceQuotas
- CustomResourceDefinitions

Helm:
- Full Helm SDK integration
- Releases
- Values / Manifest / History / Notes

---

## Milestones

### ✅ Milestone 1 — Full UI Overview

Complete, RBAC-aware, cross-linked, view-only UI for:

- Core Kubernetes workloads
- Networking
- Storage
- RBAC
- CRDs
- Helm (SDK-backed)
- Namespace aggregated overview
- ResourceQuotas with gauges

Status: COMPLETE

---

### ✅ Milestone 2 — Full Resource Control

Cluster mutation support implemented across all major resource categories.

Includes:

- Install / upgrade / uninstall (Helm)
- Delete for all supported resources
- Scale workloads (Deployments, StatefulSets, etc.)
- Rollout restart where applicable
- Safe confirmation dialogs
- Centralized mutation handling
- RBAC-aware action gating via capabilities endpoint
- Clear error surfacing through unified mutation framework

Architecture guarantees:

- No per-kind copy-paste mutation logic
- Shared backend helpers (namespaced + cluster-scoped)
- Unified frontend mutation descriptors
- Strict UI contract enforcement

Status: COMPLETE

---

### 🚧 Milestone 3 — Web Terminal

- Exec into containers
- WebSocket streaming
- RBAC-aware
- Controlled lifecycle

Status: PLANNED

---

### 🚧 Milestone 4 — Port Forwarding

- UI-driven port forwarding
- Live session management
- Visual feedback

Status: PLANNED

---

### 🚧 Milestone 5 — Plugin / Extension System

- Custom views
- Custom resource renderers
- Configurable extensions

Status: FUTURE

---

## Development

Build:

    make build

Run:

    ./kview

---

## Design Contract

All UI changes must follow:

- docs/UI_UX_GUIDE.md
- docs/AI_AGENT_RULES.md
