# kview

kview is a **local, single-binary Kubernetes UI** for fast, view-first cluster exploration. It runs entirely on your machine — no cloud service, no agent installation, no cluster-side components required.

---

## Why kview

- **Single binary, zero install.** Drop the binary on your machine and point it at your kubeconfig. Embed auth plugins on `PATH` if your contexts use them; nothing else is needed.
- **Honest, truthful read metadata.** Every list response carries `freshness`, `coverage`, `degradation`, `completeness`, and coarse `state` so you know exactly what you are looking at, not just a stale table with no indication of when it was last read.
- **Deep cross-resource navigation.** Drawer-based inspection with nested drawers, cross-resource links, and related-resource panels let you follow a signal from a dashboard alert through to a pod log or config map without leaving the UI.
- **RBAC-aware throughout.** Capability checks gate every action button and gracefully degrade list and detail views when permissions are limited. Derived projections such as node workload rollups from cached pod snapshots remain useful even when direct node reads are denied.
- **Predictable operator workflows.** The cluster dashboard, namespace summaries, and signals panels are designed for triage. Signals carry stable identity, advisory text, and filter keys so you can drill from a cluster-wide view into a specific namespace and then into the exact resource.
- **Smart background reads.** A scheduler-mediated dataplane handles list snapshot TTLs, deduplication, priority queuing, and partial/degraded responses. The UI refreshes in the background; you do not need to manually poll.
- **Custom commands and actions.** Define container command presets (run on matching pod containers) and workload action presets (set/unset env, set image, raw JSON patch) from the Settings view without touching the binary.

---

## Getting Started

### Binary releases

Pre-built binaries for Linux, macOS, and Windows are published on the [GitHub Releases](../../releases) page for every `v*` tag.

Release binaries are built for browser/server modes. Desktop webview mode requires a local build with webview support; see [Desktop webview mode](#desktop-webview-mode).

Download the binary for your platform, make it executable, and run:

```bash
kview
```

This starts the local server and opens the UI in your default browser.

To point kview at a specific kubeconfig file or directory:

```bash
kview --config ~/.kube/my-config
```

`--config` overrides `KUBECONFIG`. If neither is set, kview uses the default `~/.kube/config`.

kview uses `client-go` authentication from the selected kubeconfig. If a context uses an `exec` auth plugin, the referenced command (e.g. `kubectl`, `kubelogin`, a cloud-provider CLI) must be installed and available on `PATH` where kview runs.

On Windows, running kview from WSL is the simpler path because kubeconfig paths, shell behavior, and auth helper commands tend to match the Linux-native Kubernetes tooling setup more closely.

### Install with Go

If you have Go installed, you can install kview directly from the module:

```bash
go install github.com/korex-labs/kview/v5/cmd/kview@latest
```

This places the `kview` binary in your Go install bin directory, usually `$(go env GOPATH)/bin` or `$(go env GOBIN)` if set. Make sure that directory is on your `PATH`, then run:

```bash
kview
```

The default Go install path builds browser/server modes. Desktop webview mode requires the `webview` build tag; see [Desktop webview mode](#desktop-webview-mode).

The `/v5` path is required by Go's semantic import versioning. Using the unsuffixed module path can make Go ignore current `v5` tags and fall back to an older `v1` tag.

To enable the local release-tag guard, run:

```bash
make install-git-hooks
```

To create a guarded release tag, run:

```bash
make release-tag TAG=v5.5.0
```

Release notes live in [CHANGELOG.md](CHANGELOG.md). `make release-tag` validates the Go module path, asks Codex to summarize commits from the latest release tag into the changelog, commits that changelog update, validates again, and only then creates the annotated tag. The target requires a clean worktree before it starts so the changelog commit does not include unrelated local edits.

The release-note helper runs Codex with `gpt-5` by default so personal Codex model settings do not affect tagging. Override it with `CODEX_MODEL`, for example `CODEX_MODEL=gpt-5.4 make release-tag TAG=v5.5.0`.

To prepare and commit release notes without tagging yet:

```bash
make release-notes TAG=v5.5.0
```

Git does not provide a native pre-tag hook, so the helper validates before creating the tag. The installed pre-push hook also blocks pushing manually created tags such as `v6.0.0` unless `go.mod` declares the matching `/v6` module path and prints the migration steps to fix it.

### Desktop webview mode

Desktop webview mode is only available in binaries built with the `webview` build tag. Release binaries are built without it.

To build kview with Linux webview support through the pinned Docker toolchain:

```bash
make build-webview
```

Then run:

```bash
./kview
```

Webview-enabled builds use webview as the default launch mode. You can also request it explicitly:

```bash
./kview --mode webview
```

This runs the same embedded HTTP server and UI inside a native desktop webview window instead of opening a browser tab.

### Build from source

```bash
make build
```

This produces a regular browser/server-mode binary through the pinned Docker toolchain. To include Linux desktop webview support, use:

```bash
make build-webview
```

Release-style artifacts:

```bash
make build-release GOOS=linux GOARCH=amd64 OUTPUT=dist/kview-linux-amd64
```

`make`, `make check`, `make build`, `make build-webview`, and `make build-release` all run through the pinned Docker toolchain by default and keep Go/npm build caches under `.cache/`, so local rebuilds reuse dependency artifacts without requiring a host Go or Node.js installation.

The `local-*` Makefile targets are implementation details for the Docker container or explicit maintainer debugging. AI coding agents must not call host `go`, `npm`, `node`, or `local-*` targets unless the project owner explicitly asks for a host-toolchain exception.

### Go linting

Run Go lint checks through the pinned Docker toolchain:

```bash
make lint-go
```

This runs `golangci-lint` with a practical baseline (`govet`, `staticcheck`, `errcheck`, `unused`, `ineffassign`, and `gofmt` checks).

---

## Features

### Resource exploration

- Dense resource tables with filtering and sorting across all standard Kubernetes resource kinds
- Drawer-based detail inspection with YAML, events, related resources, and status-focused summaries
- Guarded inline YAML editing on supported resources with validation, typed confirmation, and conflict-aware live apply
- Nested drawers and cross-resource navigation
- Capability-aware action buttons: delete, restart, scale, RBAC operations, Helm operations, and custom workload patches

### Cluster dashboard and signals

- Cluster-wide summary with namespace and node snapshot blocks, resource totals, and attention signals
- Signals cover elevated pod restarts, stale Helm releases, abnormal jobs, quota pressure, empty ConfigMaps/Secrets, and low-confidence potentially unused PVCs and service accounts
- Each signal carries stable identity, severity, advisory text (`likelyCause`, `suggestedAction`), and backend-provided quick-filter keys
- Derived node workload rollups and Helm chart catalog rows from cached snapshots when direct reads are limited

### Namespace summaries and insights

- Projection-backed namespace summaries with workload health rollups, RBAC counts, Helm release list, and coverage metadata
- Namespace insights surface the exact signals for each ResourceQuota, PVC, Service, or Helm release by resource identity
- Partial/degraded payloads returned instead of hard-failing when only part of the namespace is visible

### Read-side dataplane

- Per-context snapshot stores with scheduler-mediated TTLs, deduplication, priority queuing, and bounded concurrency
- Namespace and node observers, idle-gated enrichment, and background sweep option for large clusters
- Optional local snapshot persistence in a bbolt file for stale fallback and quick-access search (`GET /api/dataplane/search`)
- All list responses include `freshness`, `coverage`, `degradation`, `completeness`, and `state` metadata

### Mutations

```text
POST /api/actions
```

Supported families: delete, restart, scale, selected workload and RBAC operations, Helm install/upgrade/uninstall. Handlers are registered in the backend `ActionRegistry`; the UI checks RBAC capabilities before surfacing each button.

### Activity panel

- Terminal sessions, port-forward sessions, runtime/system status
- Namespace row enrichment progress and long-running dataplane snapshot activity

### User settings

Browser-local settings profile (stored in `localStorage`, importable/exportable as JSON) controls:

- Dashboard refresh and initial Activity Panel state
- Smart-filter chip generation and scoped filter rules
- Custom container command presets and custom workload action presets
- Dataplane policy: snapshot TTLs, enrichment caps, observer intervals, scheduler budget, dashboard signal thresholds

---

## Architecture

### Backend

Written in Go:

- `client-go` Kubernetes integration
- REST API via `chi`, embedded UI via `go:embed`
- Generic mutation endpoint: `POST /api/actions` with central `ActionRegistry`
- RBAC capability checks: `POST /api/capabilities` and `POST /api/auth/can-i`
- Read-side dataplane: snapshots, scheduler, observers, projections
- Runtime activity system, terminal sessions, port-forward sessions, short-lived container exec

### Frontend

Built with React, Vite, TypeScript, and MUI. Uses shared resource list and drawer patterns, capability-aware actions, typed API responses, and reusable design tokens.

---

## Documentation

If you are an AI coding agent using this README as context, read these files before making changes:

- [AGENTS.md](AGENTS.md)
- [docs/AI_BOOTSTRAP_PROMPT.md](docs/AI_BOOTSTRAP_PROMPT.md)
- [docs/DEV_CHECKLIST.md](docs/DEV_CHECKLIST.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATAPLANE.md](docs/DATAPLANE.md)
- [docs/API_READ_OWNERSHIP.md](docs/API_READ_OWNERSHIP.md)
- [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md)

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Product architecture and boundaries |
| [docs/DATAPLANE.md](docs/DATAPLANE.md) | Read-side dataplane, snapshots, projections, metadata |
| [docs/API_READ_OWNERSHIP.md](docs/API_READ_OWNERSHIP.md) | Route-by-route read ownership map |
| [docs/UI_UX_GUIDE.md](docs/UI_UX_GUIDE.md) | UI architecture and UX contracts |
| [docs/DEV_CHECKLIST.md](docs/DEV_CHECKLIST.md) | Review checklist for changes |
| [AGENTS.md](AGENTS.md) | Canonical execution rules for AI-assisted development |
| [docs/AI_BOOTSTRAP_PROMPT.md](docs/AI_BOOTSTRAP_PROMPT.md) | Bootstrap context for executor agents |
| [docs/AI_AGENT_RULES.md](docs/AI_AGENT_RULES.md) | Compatibility pointer to `AGENTS.md` |

Documentation is a contract. Update it in the same change whenever architecture, read ownership, UI contracts, or operator-visible behavior changes.
