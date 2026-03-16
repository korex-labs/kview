# Stage 5 Dataplane Status

This document describes what the Stage 5 dataplane currently owns in code, what remains direct-read, and how metadata and observers behave.

---

## Owned by `internal/dataplane` today

### Per-cluster planes

- `DataPlaneManager` manages one `ClusterPlane` per kube context.
- Each `ClusterPlane` owns:
  - **Capability registry** for that cluster (read-side learning from namespaces, nodes, pods, deployments).
  - **Raw snapshots**:
    - Cluster-wide namespaces
    - Cluster-wide nodes
    - Namespaced pods
    - Namespaced deployments
  - **Observer state**:
    - Namespaces observer
    - Nodes observer
  - **Plane health** (coarse).

All of this is keyed by **context name**, using `cluster.Manager.GetClientsForContext`.

### Scheduler-mediated reads

- All dataplane snapshots use a shared scheduler:
  - Per-cluster concurrency limits.
  - In-flight de-duplication.
  - Bounded retry/backoff for transient/proxy errors.
- Snapshots are cached on the plane, with TTLs:
  - Namespaces: ~15s
  - Pods / Deployments: ~15s
  - Nodes: ~30s

### Namespace summary projection

- `/api/namespaces/{name}/summary` is now projection-backed:
  - Starts from `kube.GetNamespaceSummary` to preserve existing behavior:
    - Workload counts
    - Networking counts
    - Storage/config counts
    - Helm counts and release list
    - Problematic resources (jobs/other kinds)
  - Overlays dataplane snapshots for **pods and deployments**:
    - Recomputes pod/deployment counts and health from snapshots.
    - Rebuilds pod/deployment problematic entries from snapshots, keeping legacy non-pod/deployment problematic entries.
    - Pods and deployments in this view are considered **dataplane-owned**.
  - Attaches projection metadata (`NamespaceSummaryMetaDTO`) for:
    - `freshness`, `coverage`, `degradation`, `completeness`, `state`.

### Dashboard summary

- `/api/dashboard/cluster` returns a small summary built from dataplane snapshots:
  - Namespace counts and “unhealthy” marker (from `HasUnhealthyConditions`).
  - Node counts.
  - Freshness/coverage/degradation/completeness/state for both.

---

## Still direct-read

The following remain direct `kube` reads today and are **not yet** backed by dataplane snapshots:

- Most resource list/detail handlers (except the namespace list and summary).
- Parts of namespace summary beyond pods/deployments:
  - Jobs
  - StatefulSets
  - DaemonSets
  - CronJobs
  - Services
  - Ingresses
  - PVCs
  - ConfigMaps
  - Secrets
  - Helm summary internals

These are still correct but do not yet benefit from scheduler-mediated caching/normalization.

---

## Observer activation, lifecycle, and visibility

### Activation

- Observers are started when the UI hits:
  - `/api/namespaces` for the **active** context.
- That call:
  - Resolves the current kube context.
  - Calls `DataPlaneManager.EnsureObservers` for that context.
  - Uses the dataplane namespaces snapshot as the backing source for the list.
- Startup is intentionally **endpoint-driven** rather than global:
  - There is no process-wide "start all observers for all clusters" loop.
  - Only clusters that are actively viewed incur observation cost.
  - This keeps the system bounded for multi-cluster setups.

### Behavior and lifecycle

- Namespaces observer:
  - Periodically refreshes the namespaces snapshot for that context.
  - Moves through explicit states: starting, active, blocked_by_access, backoff, degraded, stopped.
- Nodes observer:
  - Periodically refreshes the nodes snapshot.
  - Applies simple exponential backoff when access is blocked or upstream is unstable.

Operators may see the following `ObserverState` values in logs or the dashboard:

- `starting` / `active` / `running`: observer is healthy and making progress.
- `blocked_by_access`: RBAC denies required reads; capabilities will reflect denial.
- `backoff`: repeated failures; observer is temporarily backing off.
- `degraded`: observer is running but has seen recent transient issues.
- `stopped` / `failed`: observer is no longer running for that cluster.
- `idle` / `waiting_for_scope` / `uncertain`: internal states used when a plane is created but not yet fully activated.

### Runtime logs

- When observer state transitions, a single log entry is written to the runtime log buffer:
  - Source: `dataplane`
  - Message includes observer kind, cluster name, and old/new state.
- When the nodes observer enters backoff, a log entry records the new interval.
- These logs appear in the existing Activity Panel logs view.

### "not_loaded" and deferred lifecycle behavior

- Some dataplane surfaces may describe a plane or projection as `not_loaded` or equivalent when:
  - No observers have ever been started for the active context.
  - No snapshots have yet been taken for that plane.
- There is intentionally **no** automatic background initialization of all planes today:
  - Planes are created lazily when first accessed.
  - Observers start only when relevant endpoints (like `/api/namespaces`) are hit.
- Future stages may introduce:
  - More explicit plane lifecycle controls (start/stop per cluster).
  - Background warm-up for selected clusters or profiles.
  - Configuration for which profiles/discovery modes to use.

---

## Truthfulness metadata on dataplane-backed APIs

### `/api/namespaces` (list)

Response fields:

- `items`: namespace list
- `active`: current context
- `limited`: currently always `false`
- `observed`: snapshot timestamp

The backing snapshot tracks:

- `freshness`: hot/cold/unknown
- `coverage`: currently `full` from the snapshot’s perspective, but the list is still a legacy direct-read elsewhere.
- `degradation`: none/minor/severe
- `completeness`: complete/inexact/unknown

Future work may expose a full `meta` envelope here once more endpoints are moved behind the dataplane.

### `/api/namespaces/{name}/summary`

Response shape:

- `item`: `NamespaceSummaryResourcesDTO` including:
  - `counts`, `podHealth`, `deploymentHealth`, `problematic`, `helmReleases`.
  - `meta` (`NamespaceSummaryMetaDTO`):
    - `freshness`
    - `coverage` (currently `partial`)
    - `degradation`
    - `completeness` (currently `inexact`)
    - `state`: `ok`, `empty`, `denied`, `partial_proxy`, or `degraded`.

The UI shows `state`, `freshness`, and `coverage` in the namespace drawer.

### `/api/dashboard/cluster`

Response:

- `item`: `ClusterDashboardSummary`:
  - `namespaces` and `nodes` each expose:
    - `total`, `unhealthy` (namespaces only), and
    - `freshness`, `coverage`, `degradation`, `completeness`, `state`.

---

## Remaining Stage 5 work

- Migrate additional list/detail endpoints to use dataplane snapshots where appropriate.
- Expand projection-backed views beyond namespace summary.
- Standardize a metadata envelope for all dataplane-backed responses (including `/api/namespaces`) and increase UI surfacing of state/freshness when useful.
- Extend observers and snapshots for more resource types while keeping scope and API budgets bounded.

