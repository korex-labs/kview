# Stage 5 Dataplane Status

This document summarizes dataplane ownership, projections, and what remains **direct-read by explicit exception**. The **route-by-route** map lives in **`docs/STAGE5C_READ_SUBSTRATE.md`** (maintain both when behavior changes).

**Final punchlist (pre–5D):** `docs/STAGE5C_FINAL_PUNCHLIST.md` — Prompt 01 (daemonsets/statefulsets/jobs/cronjobs/replicasets **list** migration) is verified **done** in-tree; remaining deferred namespaced lists are documented in the read-substrate doc.

---

## Owned by `internal/dataplane` today

### Per-cluster planes

- `DataPlaneManager` manages one `ClusterPlane` per kube context.
- Each `ClusterPlane` owns:
  - **Capability registry** for that cluster (read-side learning from namespaces, nodes, pods, deployments).
  - **Raw snapshots** (namespace-scoped unless noted):
    - Cluster-wide: **namespaces**, **nodes**
    - Pods, deployments, daemonsets, statefulsets, replicasets, jobs, cronjobs
    - Services, ingresses, persistentvolumeclaims, configmaps, secrets
  - **Observer state**: namespaces observer, nodes observer
  - **Plane health** (coarse)

All keyed by **context name** via `cluster.Manager.GetClientsForContext`.

### Scheduler-mediated reads

- Snapshots use a shared scheduler: per-cluster concurrency, in-flight de-duplication, bounded retry/backoff.
- Cached on the plane with TTLs (~15s namespaced workloads, ~15s namespaces, ~30s nodes).

### Namespace summary projection

- `/api/namespaces/{name}/summary` is **projection-led** (Stage 5C): `NamespaceSummaryProjection` builds from dataplane snapshots only—**not** `kube.GetNamespaceSummary` in the handler.
  - Counts and health for all snapshot-owned kinds; `workloadByKind`, `restartHotspots` (bounded).
  - **Helm** is not snapshot-owned: helm list/count stay empty; metadata remains **partial / inexact** where Helm is part of the contract.
  - `NamespaceSummaryMetaDTO`: `freshness`, `coverage`, `degradation`, `completeness`, `state`.

### Dashboard summary

- `/api/dashboard/cluster` uses `DashboardSummary`: namespace + node snapshot metadata, optional **workload hints** (bounded cross-namespace pod restart sample—not cluster-complete).

### List API enrichment (Stage 5C)

- Pods and deployments list rows can include small **projection-derived** fields computed from snapshot DTOs in-handler (`EnrichPodListItemsForAPI`, `EnrichDeploymentListItemsForAPI`)—no extra kube calls.

---

## Default dataplane-backed (main namespaced list surfaces)

These use `*Snapshot` + `writeDataplaneListResponse` (or namespaces’ equivalent envelope):

- `/api/namespaces/{ns}/pods` … `/secrets` for the kinds listed in **STAGE5C_READ_SUBSTRATE.md** §1.

Also:

- `/api/namespaces` — namespaces list + `meta` + bounded **row projection** (`rowProjection` + per-item workload fields from pods/deployments snapshots).
- `/api/dashboard/cluster` — structured overview: `plane`, `visibility` (ns/node snapshots + trust copy), `resources` + `hotspots` (same bounded namespace sample for rollups), `workloadHints` (backward-compatible hotspot fields).

---

## Explicit direct-read exceptions (summary)

**Canonical list:** `docs/STAGE5C_READ_SUBSTRATE.md` §4.

Categories:

- **Namespace detail** (`/api/namespaces/{name}`) and **resource quotas** list.
- **Deferred namespaced lists**: serviceaccounts, roles, rolebindings, helmreleases (+ `GET /api/helmcharts`).
- **Cluster-scoped** APIs: nodes, clusterroles/bindings, CRDs, PVs (and their detail/events/yaml).
- **All** detail / events / YAML (where routed) / relation lookups for kinds that have those endpoints— even when the **list** for that kind is dataplane-backed.
- **Product** APIs: activity, sessions, healthz, contexts, websockets, auth can-i.

---

## Observer activation, lifecycle, and visibility

### Activation

- Observers start when the UI hits `/api/namespaces` for the **active** context (`EnsureObservers`).
- Endpoint-driven, not global: only actively viewed clusters pay observation cost.

### Behavior

- Namespaces and nodes observers refresh periodically; explicit states (`starting`, `active`, `blocked_by_access`, `backoff`, `degraded`, …).
- Transitions are logged to the runtime log buffer (`dataplane` source).

### `not_loaded` / lazy planes

- No automatic background init of all planes; lazy creation on first access.

---

## Truthfulness metadata on dataplane-backed APIs

### `/api/namespaces` (list)

- `items`, `observed`, `meta` (`freshness`, `coverage`, `degradation`, `completeness`, `state`).
- Backed by **NamespacesSnapshot** (not a legacy handler read).

### `/api/namespaces/{name}/summary`

- `item` includes resource DTOs + `meta` (`NamespaceSummaryMetaDTO`).
- UI surfaces state/freshness/coverage in the namespace drawer.

### Dataplane list envelope (`writeDataplaneListResponse`)

- `active`, `items`, `observed`, `meta` with the same core keys as above. Covered by `TestWriteDataplaneListResponse_*` in `internal/server`.

### `/api/dashboard/cluster`

- `ClusterDashboardSummary` with namespace/node blocks and optional workload hints.

---

## Remaining work (post–5C, not blocking 5C closure)

- Migrate **deferred** namespaced lists (serviceaccounts, roles, rolebindings, helm) if/when snapshot semantics are defined.
- Optional: dataplane-backed **node list** API to align list UX with dashboard snapshot metadata.
- Expand observers/snapshots only with explicit scope and API budget.
- Uniform metadata envelope across every API (including non-dataplane routes)—product decision.

---

## Stage history (compact)

- **5B:** First namespaced list migration (pods, deployments, services, ingresses, PVCs, configmaps, secrets).
- **5C wave 2:** Daemonsets, statefulsets, jobs, cronjobs, replicasets lists.
- **5C waves 3–4:** Namespace summary projection-only, list enrichment for pods/deployments, drawer/dashboard hints.
- **5C wave 5 (closure):** `STAGE5C_READ_SUBSTRATE.md`, doc alignment, tests for list response shape.
