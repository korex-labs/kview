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

**Namespaced snapshot kinds:** pods, deployments, daemonsets, statefulsets, replicasets, jobs, cronjobs, services, ingresses, persistentvolumeclaims, configmaps, secrets, serviceaccounts, roles, rolebindings, helmreleases.

Typical TTLs are on the order of **~15s** for namespaced workload lists and namespaces, **~30s** for nodes (see code for exact values).

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

`GET /api/dashboard/cluster` uses **`DashboardSummary`**: namespace and node snapshot blocks, trust copy, resource totals for all dataplane-owned namespaced list kinds from cached namespace snapshots, and optional **bounded** workload hints (cross-namespace sampling is not cluster-complete). See response types in `internal/dataplane/dashboard.go`.

---

## Namespaces list and row enrichment

`GET /api/namespaces` returns the **namespaces snapshot** immediately with **`rowProjection.revision`** (and loading hints). Background work (scored subset, idle-gated) enriches rows; the UI polls **`GET /api/namespaces/enrichment?revision=…`** for merged rows.

Design constraints (see `internal/dataplane` for implementation):

- Enrichment targets are chosen from **hint-driven scoring** (focus namespace, favourites, recency), not a full alphabetical cluster walk.
- **Cap** on how many namespaces get enrichment and **limited parallelism**.
- **Idle gate:** enrichment starts only after API **user activity** has been quiet for a short window; polling the enrichment endpoint **does not** reset that timer.
- **Stable refresh:** a repeated namespace list refresh reuses the active enrichment revision when the list order and target set are unchanged. Refreshed base rows keep any already-enriched pod/deployment counts and restart signals.
- **Activity identity:** namespace row enrichment uses one stable activity ID per cluster instead of revision-numbered activity rows.

List rows for **pods**, **deployments**, and workload controllers can include small **projection-derived** fields from snapshot DTOs in the list handler (`Enrich*ListItemsForAPI`) without extra kube calls.

---

## Observers

- **Activation:** `EnsureObservers` runs when the UI touches dataplane-backed endpoints for the **active** context (e.g. namespaces list)—so only actively used clusters pay observation cost.
- Namespaces and nodes observers refresh on an interval; state is coarse (`starting`, `active`, backoff classes, etc.) and transitions are logged under the **`dataplane`** runtime source.
- There is **no** global warm-up of every kube context in the kubeconfig.

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
- **Namespace detail** (`GET /api/namespaces/{name}`) and **resource quotas** list are direct reads.
- **Detail, events, YAML, relation** endpoints remain direct reads even when the **list** for that kind is dataplane-backed.
- A **uniform metadata envelope on every API** (including legacy list routes) is not guaranteed; that would be a product-wide decision.
