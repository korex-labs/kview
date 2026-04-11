# kview

kview is a **local, single-binary Kubernetes UI** for fast, view-first cluster exploration.

It embeds a **React + MUI frontend** inside a **Go backend**, uses the operator's kubeconfig, and keeps normal operation local: no external service is required.

The project focuses on:

- operational clarity
- RBAC-aware actions and reads
- deep cross-resource navigation
- drawer-based inspection
- truthful read metadata
- predictable operator workflows

---

## Current State

kview now has read-side dataplane in place for the main list surfaces. The UI uses scheduler-mediated snapshots and projections for high-frequency reads, while intentional direct reads remain visible and documented for details, events, YAML, relation lookups, resource quotas, cluster-scoped catalog/RBAC/storage families, and Helm chart catalog reads.

Important current behaviors:

- Dataplane-backed list responses include `freshness`, `coverage`, `degradation`, `completeness`, and coarse `state` metadata.
- List views and the cluster dashboard refresh in the background without requiring a page reload.
- Namespace summaries are projection-backed from dataplane snapshots and return usable partial/degraded payloads instead of hard-failing when only part of the namespace is visible.
- The cluster dashboard and relevant resource surfaces include explicitly labeled derived signals, such as node workload rollups from cached pod snapshots and Helm chart rows grouped by chart name with version rollups from cached Helm release snapshots, for restricted-permission environments.
- Namespace list row enrichment is scoped to current, recent, and favourite namespaces by default; it is idle-gated and preserves previously enriched rows across refreshes. An opt-in background sweep can slowly enrich additional namespaces while the app is idle.
- User settings are browser-local and include refresh defaults, smart-filter rules, custom container commands, custom workload actions, namespace enrichment/dataplane policy, and JSON import/export.
- Dataplane-backed read APIs accept optional `X-Kview-Context` so the UI can pin reads to the context that was active when the request was issued.
- Mutations remain on the shared action framework and are not part of the dataplane.

See [docs/DATAPLANE.md](docs/DATAPLANE.md) and [docs/API_READ_OWNERSHIP.md](docs/API_READ_OWNERSHIP.md) for the precise read ownership contract.

---

## Architecture

### Backend

The backend is written in Go and includes:

- `client-go` Kubernetes integration
- REST API via `chi`
- embedded UI via `go:embed`
- generic mutation endpoint: `POST /api/actions`
- central `ActionRegistry` with resource mutation handlers grouped under `internal/kube/actions`
- RBAC capability checks: `POST /api/capabilities` and `POST /api/auth/can-i`
- read-side dataplane: snapshots, scheduler, observers, projections
- runtime activity system
- terminal and port-forward sessions
- short-lived custom container command execution

### Frontend

The frontend is built with:

- React
- Vite
- TypeScript
- MUI

The UI uses shared resource list and drawer patterns, capability-aware actions, typed API responses, and reusable design tokens for consistent operator-focused screens.

---

## Supported Resource Areas

### Workloads

- Pods
- Deployments
- ReplicaSets
- StatefulSets
- DaemonSets
- Jobs
- CronJobs

### Networking

- Services
- Ingresses

### Storage

- PersistentVolumeClaims
- PersistentVolumes

### Configuration

- ConfigMaps
- Secrets

### Access Control

- ServiceAccounts
- Roles
- RoleBindings
- ClusterRoles
- ClusterRoleBindings

### Cluster

- Nodes
- Namespaces
- ResourceQuotas
- CustomResourceDefinitions

### Helm

- Helm charts
- Helm releases
- Values
- Manifests
- History
- Notes
- Managed resources

---

## Core Features

### Resource Exploration

- dense resource tables with filtering and sorting
- drawer-based detail inspection
- cross-resource links and nested drawers
- resource-specific actions where supported
- YAML, events, related resources, and status-focused summaries where available

### Read-Side Dataplane

- cached list snapshots per Kubernetes context
- scheduler-mediated list reads with bounded concurrency
- namespace and node observers
- dataplane metadata in migrated list envelopes
- projection-only namespace summaries
- dashboard totals from cached dataplane-owned namespace snapshots
- derived sparse dashboard signals for nodes and Helm charts
- partial/degraded responses when useful data is still available

### Mutation Framework

Mutations use:

```text
POST /api/actions
```

Supported action families include delete, restart, scale, selected workload and RBAC operations, and Helm operations. Handlers are registered in the backend `ActionRegistry`; the UI checks capabilities before surfacing actions.

### Activity Panel

The Activity Panel shows runtime and operational activity, including:

- terminal sessions
- port-forward sessions
- runtime/system status
- namespace row enrichment activity
- dataplane snapshot work that exceeds the configured long-run threshold

### User Settings

The Settings view is opened from the header and stores a browser-local settings profile in `localStorage`. The current profile controls frontend refresh defaults, initial Activity Panel state, scoped smart-filter chip generation, custom container command presets, custom workload action presets, and the process-local dataplane policy synced to the running backend. Import/export covers only this settings profile; active context, active namespace, favourites, recent namespace history, and theme remain separate.

Custom container commands are shown on matching Pod containers and run through short-lived non-interactive pod exec requests. The default command is `Environment`, which runs `/bin/env` and renders stdout as key-value output. Custom workload actions are shown on patch-capable Deployments, StatefulSets, DaemonSets, and ReplicaSets, and support set/unset env, set image, and raw JSON/merge patches. Namespace enrichment tuning controls focused enrichment, optional idle background sweep, observer intervals, snapshot TTLs, scheduler budget, and dashboard hotspot thresholds.

---

## Launch Modes

### Browser Mode

```bash
kview
```

Starts the local server and opens the UI in a browser.

To use a kubeconfig file or a directory containing kubeconfig files:

```bash
kview --config "C:\Users\alice\.kube\config"
```

`--config` overrides `KUBECONFIG`. If neither is set, kview uses the default
`~/.kube/config`.

kview uses Kubernetes `client-go` authentication from the selected kubeconfig.
If a context uses an `exec` auth plugin, the referenced command must be
installed and available on `PATH` where kview runs. For example, kubeconfigs may
call `kubectl`, `kubelogin`, cloud-provider CLIs, or another command declared in
the kubeconfig.

On Windows, running kview from WSL is currently the simpler path because
kubeconfig paths, shell behavior, and auth helper commands tend to match the
Linux-native Kubernetes tooling setup more closely.

### Webview Mode

```bash
kview --webview
```

Runs the same embedded HTTP server and UI inside a native desktop webview window.

---

## Build

```bash
make build
```

To build with the pinned Docker toolchain and write the binary back into the
repo:

```bash
make build-docker
```

Release-style artifacts can be produced with:

```bash
make build-docker-release GOOS=linux GOARCH=amd64 OUTPUT=dist/kview-linux-amd64
```

Docker builds bind-mount the repository and keep Go/npm build caches under
`.cache/`, so local rebuilds reuse dependency artifacts without relying on the
host Go or Node.js installation.

For the embedded webview build:

```bash
make build-webview
```

The build regenerates embedded UI assets under `internal/server/ui_dist`.

GitHub release builds run only when a `v*` tag is pushed. The workflow builds
Linux, macOS, and Windows browser/server binaries in Docker and publishes them
to the matching GitHub release.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Product architecture and boundaries |
| [docs/DATAPLANE.md](docs/DATAPLANE.md) | Read-side dataplane, snapshots, projections, metadata |
| [docs/API_READ_OWNERSHIP.md](docs/API_READ_OWNERSHIP.md) | Route-by-route read ownership map |
| [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md) | UI architecture and UX contracts |
| [docs/DEV_CHECKLIST.md](docs/DEV_CHECKLIST.md) | Review checklist for changes |
| [docs/AI_AGENT_RULES.md](docs/AI_AGENT_RULES.md) | Execution rules for AI-assisted development |

Documentation is a contract. Update it in the same change whenever architecture, read ownership, UI contracts, or operator-visible behavior changes.
