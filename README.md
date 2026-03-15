# kview

kview is a **local, single-binary, view-first Kubernetes UI** inspired by tools like Lens and k9s.

It embeds a **React + MUI frontend inside a Go backend** and runs as a standalone binary.

The project focuses on:

- operational clarity
- strict RBAC awareness
- deep cross-resource navigation
- consistent UI contracts
- predictable operator workflows

kview is designed to be **fast, local, and automation-friendly**.

---

# Philosophy

kview follows several core principles:

- **Local-first**
- **View-first UI**
- **RBAC-aware operations**
- **Cross-resource navigation**
- **Consistent UI architecture**
- **Minimal operational friction**

The UI prioritizes **clarity, density, and operator efficiency** over visual noise.

---

# Architecture

## Backend

Written in Go.

Key components:

- `client-go` Kubernetes integration
- REST API (`chi`)
- Embedded UI (`go:embed`)
- Generic mutation endpoint (`/api/actions`)
- Centralized **ActionRegistry**
- RBAC-aware capability detection (`/api/capabilities`)
- Shared mutation helpers

Runtime features:

- Activity runtime
- Session management
- Terminal sessions
- Port-forward sessions

---

## Frontend

Built with:

- React
- Vite
- MUI (Material UI)
- TypeScript

Key UI architecture concepts:

- **Drawer-based navigation**
- **Shared component system**
- **UI tokens for styling**
- **Capability-aware action rendering**
- **Reusable resource table patterns**
- **Generic mutation dialogs**

UI design strongly favors:

- component reuse
- layout consistency
- minimal duplication

---

# Supported Resources

## Workloads

- Pods
- Deployments
- ReplicaSets
- StatefulSets
- DaemonSets
- Jobs
- CronJobs

## Networking

- Services
- Ingresses

## Storage

- PersistentVolumeClaims
- PersistentVolumes

## Configuration

- ConfigMaps
- Secrets

## Access Control

- Roles
- RoleBindings
- ClusterRoles
- ClusterRoleBindings

## Cluster

- Nodes
- Namespaces
- ResourceQuotas
- CustomResourceDefinitions

## Helm

- Helm releases
- Values
- Manifest
- History
- Notes

---

# Core Features

## Resource Exploration

- High-density resource tables
- Drawer-based inspection
- Deep cross-resource navigation
- Metadata-rich views

## Mutation Framework

kview implements a **generic mutation framework**:

- delete
- scale
- restart
- Helm operations
- future resource mutations

Mutations use a shared API:

POST /api/actions

Actions are registered in the backend ActionRegistry.

---

## Activity Panel

The Activity Panel provides visibility into runtime operations.

Features:

- activity timeline
- session tracking
- terminal sessions
- port-forward sessions
- mutation execution logs

---

# Launch Modes

kview supports two launch modes.

## Browser mode

Default mode.

Starts local server and opens UI in browser.

```
kview
```

---

## Webview mode

kview can launch its UI inside a **native desktop webview window**.

This mode runs:

- embedded HTTP server
- native webview window
- local UI instance

Useful for:

- desktop usage
- kiosk environments
- tightly scoped operator tooling

---

# Build

```
make build
```

or, for embeded webview

```
make build-webview
```

---

# Documentation

Important documents:

| Document | Purpose |
|--------|--------|
| UI_UX_GUIDE.md | UI architecture and UX contracts |
| AI_AGENT_RULES.md | strict development rules for AI agents |
| ARCHITECTURE_PRINCIPLES.md | core architectural rules |

Documentation acts as a **contract**.

Code should follow documented architecture unless the documentation is intentionally updated.
