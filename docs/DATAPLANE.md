# Dataplane (read side)

The **dataplane** (`internal/dataplane`) is the read-side subsystem for cluster observation: per-context **planes**, **snapshots**, a **scheduler**, **observers**, and **projections**. Mutations remain on the shared action framework (`POST /api/actions`); they are not implemented here.

For **which HTTP routes** use snapshots vs projections vs direct reads, see [API_READ_OWNERSHIP.md](API_READ_OWNERSHIP.md).

---

## Manager and planes

- **`DataPlaneManager`** creates one **`ClusterPlane`** per kube **context** name (lazy: planes appear on first use for that context).
- Each plane holds:
  - **Capability registry** (learned from namespaces, nodes, pods, deployments reads among others)
  - **Snapshot stores** for supported resource kinds (cluster-wide and namespaced)
  - **Observer state** for namespaces and nodes
  - Coarse **plane health**

Clients are resolved via `cluster.Manager.GetClientsForContext`.

---

## Snapshots

Snapshots are the unit of cached list data. **`kube.List*`** runs **inside** dataplane snapshot execution (scheduler, TTL cache, normalized errors)—not in HTTP handlers for migrated list routes.

**Cluster-scoped snapshot kinds:** namespaces, nodes.

**Namespaced snapshot kinds:** pods, deployments, daemonsets, statefulsets, replicasets, jobs, cronjobs, services, ingresses, persistentvolumeclaims, configmaps, secrets, serviceaccounts, roles, rolebindings, helmreleases, resourcequotas, limitranges.

Typical TTLs are on the order of **~15s** for namespaced workload lists and namespaces, **~30s** for nodes (see code for exact values).

Snapshot persistence is optional and off by default. When enabled, kview stores dataplane list snapshots in a local bbolt file under the user cache directory, together with a compact name index for cached quick-access search. Persisted snapshots hydrate a plane's empty in-memory snapshot stores when the plane is created or persistence is enabled, and they remain available as stale fallback data when a live refresh cannot replace them. Hydrated snapshots keep stale/degraded metadata rather than appearing fresh, and they do not overwrite already-loaded in-memory snapshots. Secret list snapshots contain list metadata such as name/type/key count, not secret values; detail drawers still perform targeted live reads.

`GET /api/dataplane/search?q=…` provides cached quick-access search over that persisted name index for the active context. Search is **not** realtime cluster-wide discovery: it only returns dataplane resources already observed and indexed from persisted snapshots. Results are ordered for quick access: Helm releases first, then deployments, then ReplicaSets/DaemonSets/StatefulSets, then the remaining kinds. The endpoint supports capped paging with `limit`/`offset` and `hasMore`. Clicking a result opens the normal resource detail drawer, which performs the targeted live detail read for that resource.

---

## Scheduler

A shared **work scheduler** limits concurrent snapshot work per cluster, **deduplicates** in-flight work by key, applies **priorities** (user-facing API vs dashboard vs observers vs enrichment), and retries transient failures with backoff.

Operators can inspect **running and queued** snapshot work via `GET /api/dataplane/work/live` (authenticated like other `/api` routes). Work rows include cluster, kind, namespace (if any), priority, source label (e.g. api, observer, enrichment), and queue/run timing.

---

## Projections

**Projections** assemble responses from **snapshots and composed metadata only**. They must not perform extra live kube reads “behind the back” of the documented API contract.

Notable projection:

- **`NamespaceSummaryProjection`** backs `GET /api/namespaces/{name}/summary`: counts, health-style rollups, RBAC counts (serviceaccounts/roles/rolebindings), Helm release count/list, bounded hotspots, `workloadByKind`, and **`NamespaceSummaryMetaDTO`** (`freshness`, `coverage`, `degradation`, `completeness`, `state`). If at least one contributing snapshot is usable, the endpoint returns a degraded/partial payload instead of hard-failing the whole summary.

---

## Dashboard summary

`GET /api/dashboard/cluster` uses **`DashboardSummary`**: namespace and node snapshot blocks, trust copy, resource totals for all dataplane-owned namespaced list kinds from cached namespace snapshots, heuristic **findings** for cached-scope attention signals, and optional **bounded** workload hints (cross-namespace sampling is not cluster-complete). Findings currently cover empty-looking namespaces, stale transitional Helm releases, abnormal Jobs/CronJobs, empty ConfigMaps/Secrets, quota pressure, and low-confidence potentially unused PVCs/service accounts when no cached pods exist in the namespace. The response includes both a capped `findings.top` list for first-glance triage and `findings.items` for category drill-down in the UI. See response types in `internal/dataplane/dashboard.go`.

---

## Namespaces list and row enrichment

`GET /api/namespaces` returns the **namespaces snapshot** immediately with **`rowProjection.revision`** (and loading hints). Background work (scored subset, idle-gated) enriches rows; the UI polls **`GET /api/namespaces/enrichment?revision=…`** for merged rows. The browser-local NS Enrichment settings sync a process-local dataplane policy to the backend; settings change the dataplane policy, not the read ownership model.

Design constraints (see `internal/dataplane` for implementation):

- Enrichment targets are chosen from **hint-driven scoring** (focus namespace, favourites, recency), not a full alphabetical cluster walk.
- **Cap** on how many namespaces get enrichment and **limited parallelism**.
- **Idle gate:** enrichment starts only after API **user activity** has been quiet for a short window; polling the enrichment endpoint **does not** reset that timer.
- **Stable refresh:** a repeated namespace list refresh reuses the active enrichment revision when the list order and target set are unchanged. Refreshed base rows keep any already-enriched pod/deployment counts and restart signals.
- **Activity identity:** namespace row enrichment uses one stable activity ID per cluster instead of revision-numbered activity rows.
- **Opt-in sweep:** focused enrichment remains the default. When background sweep is enabled, the dataplane may add a small number of non-focused namespaces per idle cycle, constrained by per-cycle and per-hour caps, with one-worker default parallelism. This is intended as a slow radar sweep for large clusters, not a full immediate namespace scan.

List rows for **pods**, **deployments**, and workload controllers can include small **projection-derived** fields from snapshot DTOs in the list handler (`Enrich*ListItemsForAPI`) without extra kube calls.

---

## Observers

- **Activation:** `EnsureObservers` runs when the UI touches dataplane-backed endpoints for the **active** context (e.g. namespaces list)—so only actively used clusters pay observation cost.
- Namespaces and nodes observers refresh on an interval; state is coarse (`starting`, `active`, backoff classes, etc.) and transitions are logged under the **`dataplane`** runtime source.
- Observer intervals and enablement are policy-controlled. Manual profile keeps dataplane snapshots but disables observers and namespace enrichment.
- There is **no** global warm-up of every kube context in the kubeconfig.

---

## Policy settings

`GET /api/dataplane/config` returns the current process-local dataplane policy and `POST /api/dataplane/config` replaces it with a validated policy. The Settings UI owns persistence in browser `localStorage` and syncs the current policy to the running backend.

Current policy knobs include:

- profile: manual, focused, balanced, wide, diagnostic
- snapshot TTLs per dataplane-owned list kind
- optional local persisted snapshot cache and max persisted age
- namespace and node observer intervals/backoff
- focused namespace enrichment: current/recent/favourite inclusion, caps, parallelism, idle quiet window, and stage toggles for namespace details, pods, deployments
- optional background namespace sweep: per-cycle cap, per-hour cap, re-enrich interval, idle gate, system namespace inclusion
- scheduler budget: per-cluster concurrency, transient retries, long-run snapshot activity threshold
- dashboard projection hints: restart threshold and hotspot limit

Validation keeps hard bounds on all numeric controls so wide/sweep settings can increase observability without unbounded cluster scans.

---

## List response metadata

Dataplane-backed **list** handlers use a shared envelope pattern (`active`, `items`, `observed`, `meta` with `freshness`, `coverage`, `degradation`, `completeness`, `state`). Tests in `internal/server` cover response shaping where applicable.
These read handlers accept optional `X-Kview-Context` so the UI can pin list and dashboard reads to the context that was active when the request was issued; missing headers fall back to the current active context.
When a snapshot returns usable items with a normalized transient/proxy/degraded error, handlers preserve the items and return the metadata state rather than discarding the payload.
The UI performs periodic background refresh for dataplane-backed list views and the cluster dashboard; this advances snapshots/projections while keeping the toolbar refresh mode off by default.

---

## Known gaps (honest)

These are **intentional** current limits, not bugs:

- **`GET /api/helmcharts`** remains a direct read until cluster-scoped Helm catalog snapshot semantics exist.
- **Namespace detail** (`GET /api/namespaces/{name}`) remains a direct read.
- **Detail, events, YAML, relation** endpoints remain direct reads even when the **list** for that kind is dataplane-backed.
- A **uniform metadata envelope on every API** (including legacy list routes) is not guaranteed; that would be a product-wide decision.
