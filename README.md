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

## Current Functionality

Core platform:
- Single local binary with embedded web UI
- Context-aware Kubernetes browsing with RBAC-sensitive behavior
- Shared activity/session runtime for long-lived operations
- Web and desktop/webview launch modes

Resource operations:
- Read and inspect all supported resources
- Cross-resource navigation through linked drawers
- Unified mutation framework for delete/scale/restart and Helm operations
- Capability-aware action rendering (`/api/capabilities`)

Activity Panel:
- Activities view with runtime/session events
- Terminal sessions with tabbed xterm views
- Port-forward session management with open/close actions
- Runtime logs with live refresh and sticky table headers

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
