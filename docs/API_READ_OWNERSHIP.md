# API read ownership

This document maps how **GET** and read-shaped **`/api`** routes source data. It is maintained against `internal/server/server.go` and `internal/dataplane`. When you add or change a user-facing read route, update this file in the same change.

---

## Principles

1. **Dataplane snapshots** are the default substrate for the main **namespaced list** surfaces the UI uses as anchors.
2. **Projections** assemble answers from those snapshots (and metadata composition only)—**no** hidden live `kube` calls inside projection builders.
3. **Direct cluster reads** in handlers are **explicit exceptions**: details, events, YAML (where present), relation lookups, cluster-scoped catalog/RBAC/storage APIs, and selected namespace helpers.

Underlying **list IO** for snapshot-backed routes is still `kube.List*` **inside** dataplane snapshot executors (scheduler, cache, normalization)—not in the HTTP handler.

---

## 1. Dataplane snapshot–backed (list envelope)

These routes use `DataPlaneManager.*Snapshot` and `writeDataplaneListResponse`. Each response includes `active`, `items`, `observed`, and `meta` (`freshness`, `coverage`, `degradation`, `completeness`, `state`).
Dataplane-backed read endpoints accept optional `X-Kview-Context`; when absent, they fall back to the process active context for backwards compatibility.

| Route pattern | Snapshot / notes |
|---------------|------------------|
| `GET /api/nodes` | `NodesSnapshot`; cluster-scoped list. If direct node list is denied/unavailable and cached pod snapshots exist, returns explicitly marked derived node rows from cached pod snapshots instead. |
| `GET /api/namespaces/{ns}/pods` | `PodsSnapshot`; rows may include projection-derived fields (`restartSeverity`, `listHealthHint`) from `EnrichPodListItemsForAPI`. |
| `GET /api/namespaces/{ns}/deployments` | `DeploymentsSnapshot`; optional `EnrichDeploymentListItemsForAPI` fields. |
| `GET /api/namespaces/{ns}/daemonsets` | `DaemonSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/statefulsets` | `StatefulSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/replicasets` | `ReplicaSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/jobs` | `JobsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/cronjobs` | `CronJobsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/services` | `ServicesSnapshot` |
| `GET /api/namespaces/{ns}/ingresses` | `IngressesSnapshot` |
| `GET /api/namespaces/{ns}/persistentvolumeclaims` | `PVCsSnapshot` |
| `GET /api/namespaces/{ns}/configmaps` | `ConfigMapsSnapshot` |
| `GET /api/namespaces/{ns}/secrets` | `SecretsSnapshot` |
| `GET /api/namespaces/{ns}/serviceaccounts` | `ServiceAccountsSnapshot` |
| `GET /api/namespaces/{ns}/roles` | `RolesSnapshot` |
| `GET /api/namespaces/{ns}/rolebindings` | `RoleBindingsSnapshot` |
| `GET /api/namespaces/{ns}/helmreleases` | `HelmReleasesSnapshot`; backed by Helm's Secret storage in the namespace. |
| `GET /api/namespaces/{ns}/resourcequotas` | `ResourceQuotasSnapshot`; also feeds namespace row quota pressure and dashboard findings. |
| `GET /api/namespaces/{ns}/limitranges` | `LimitRangesSnapshot`; also feeds namespace row limit-range count and dashboard totals. |

---

## 2. Dataplane snapshot–backed (custom JSON shape)

| Route | Behavior |
|-------|----------|
| `GET /api/namespaces` | Returns `NamespacesSnapshot` list immediately with `rowProjection.revision` / `loading`. Background stages enrich a scored subset: live **GET** per selected namespace (`GetNamespaceListFields`), then **pods + deployments** snapshots at low priority. If the namespace list order and target set are unchanged, the existing enrichment revision is reused so enriched rows remain stable across refreshes. Target namespaces are **scored from optional query hints**, not an alphabetical walk of the full list (see §2.1). UI polls `GET /api/namespaces/enrichment?revision=…`. |
| `GET /api/dashboard/cluster` | `EnsureObservers` + `DashboardSummary`: `visibility` (namespaces/nodes snapshots + observed-at), `resources` for all dataplane-owned namespaced list kinds from cached namespace snapshots, heuristic `findings` from the same cached namespace scope, derived sparse node and Helm chart signals from cached pod/Helm release snapshots, and workload `hotspots` from the cached workload subset, plus `workloadHints` alias for chips. |
| `GET /api/namespaces/enrichment?revision=` | Server-side merge for progressive namespace list rows (same revision as `GET /api/namespaces`). Includes `enrichTargets` (count of namespaces in the scored enrichment subset). Reflects in-process background work, not a direct kube call. |
| `GET /api/dataplane/search?q=…` | Cached quick-access search over the persisted dataplane name index for the active context, with `limit`/`offset` paging and `hasMore`. Prioritizes Helm releases, deployments, then ReplicaSets/DaemonSets/StatefulSets before other kinds. It does **not** perform live Kubernetes discovery; opening a result uses the normal resource detail drawer read. |

### 2.1 Namespace list: enrichment hints, scoring, idle worker

Background row enrichment is **narrow and user-aligned**:

- **No alphabetical cluster scan** for enrichment targets. The handler takes the current list snapshot order from `NamespacesSnapshot` and intersects it with names implied by hints.
- **Optional query parameters** (`ParseNamespaceEnrichHints` in `internal/dataplane`):
  - `enrichFocus` — current namespace (UI selection).
  - `enrichRecent` — MRU names, comma-separated and/or repeated keys; earlier names rank as more recent.
  - `enrichFav` — favourite names, comma-separated and/or repeated keys.
- **Scoring** (`buildEnrichmentWorkOrder`): focus ≫ favourite ≫ recency; ties break by **snapshot list index** (stable).
- **Caps:** by default at most **32** focused namespaces receive GET + pods/deployments enrichment, up to **2** in parallel. These values are configurable through the dataplane policy with hard validation bounds.
- **Idle-only start:** by default the worker waits until the API has seen **no user activity** for **2s**. Activity is updated on `/api/*` **except** `GET /api/namespaces/enrichment` (trimmed path), so enrichment polling does not reset the idle timer.
- **Optional sweep:** if enabled in NS Enrichment settings, a tiny cold set outside focus/recent/favourites can be appended after a longer idle gate, constrained by per-cycle and per-hour caps. Sweep still uses dataplane snapshots and low-priority scheduler work; it is not a direct handler read or immediate full-cluster scan.
- **Stable refresh behavior:** repeated namespace list refreshes reuse the same enrichment revision when the namespace order and target set have not changed; refreshed base rows preserve already-enriched projection fields.

**UI:** the list URL is built in `ui/src/state.ts` as `namespacesListApiPath`, using persisted `recentNamespacesByContext` and `favouriteNamespacesByContext`. The Namespaces table passes that path into `fetchRows` so list load and hints stay aligned.

---

## 3. Projection-backed (no handler-level kube list for summary body)

| Route | Behavior |
|-------|----------|
| `GET /api/namespaces/{name}/summary` | `NamespaceSummaryProjection`: counts, health rollups, RBAC counts (serviceaccounts/roles/rolebindings), Helm release count/list, `restartHotspots`, `workloadByKind`, and `NamespaceSummaryMetaDTO` from dataplane namespace-scoped snapshots only. Returns a degraded/partial usable payload when at least one contributing snapshot is usable. |
| `GET /api/namespaces/{name}/insights` | `NamespaceInsightsProjection`: namespace summary plus sorted namespace-scoped findings, full `ResourceQuota` entries, and `LimitRange` items from dataplane namespace-scoped snapshots only. Intended for the namespace drawer's observability-first view. |

---

## 4. Explicit direct-read exceptions (kube in handler)

### 4.1 Namespace helpers

| Route | Reason |
|-------|--------|
| `GET /api/namespaces/{name}` | Namespace **detail** for raw metadata/conditions/YAML (intentional direct read, lazy-loaded by the UI). |
| `GET /api/namespaces/{name}/events` | Aggregated namespace event list from Kubernetes Events in that namespace (intentional direct read, lazy-loaded by the UI). |

### 4.2 Deferred catalog reads

| Route | Reason |
|-------|--------|
| `GET /api/helmcharts` | Cluster-scoped Helm catalog; direct read. Rows are grouped by chart name and expose version rollups. If direct catalog read is denied/unavailable and cached Helm release snapshots exist, returns explicitly marked derived chart rows from cached Helm release snapshots instead. |

### 4.3 Cluster-scoped families (not dataplane list–backed)

| Routes (representative) | Notes |
|-------------------------|-------|
| `GET /api/nodes/{name}` | Node detail direct read. If direct detail is denied/unavailable and cached pod snapshots reference the node, returns an explicitly marked derived detail with pod rollups only. Node list uses `NodesSnapshot` or the derived fallback described above. |
| `GET /api/clusterroles`, `…/{name}`, events, yaml | RBAC cluster scope. |
| `GET /api/clusterrolebindings`, … | Same. |
| `GET /api/customresourcedefinitions`, … | CRD cluster scope. |
| `GET /api/persistentvolumes`, … | Storage cluster scope. |

### 4.4 Detail, events, YAML, relations

For resources that have them, these remain **direct** `kube` reads:

- `GET …/{resource}/{name}` (detail)
- `GET …/{name}/events`
- `GET …/{name}/yaml` (**only where the route exists**)
- Relation reads, e.g. `GET …/pods/{name}/services`, `GET …/services/{name}/ingresses`
- `GET …/serviceaccounts/{name}/rolebindings`

### 4.5 Product and control-plane APIs

| Route | Substrate |
|-------|-----------|
| `GET /api/healthz`, `GET /api/status`, `GET /api/contexts` | Server / cluster manager; `/api/status` additionally performs a lightweight discovery version check for active cluster reachability. |
| `GET /api/activity`, `GET /api/activity/{id}/logs` | Runtime registry / logs. |
| `GET /api/sessions`, `GET /api/sessions/{id}` | Session manager. |
| `GET …/logs/ws`, `GET …/terminal/ws` | Streaming (not snapshot reads). |
| `POST /api/auth/can-i` | SSA review (write-shaped; authz read). |
| `GET /api/dataplane/revision` | Cheap list-cell revision metadata; does not schedule kube fetches. |
| `GET /api/dataplane/work/live` | In-process snapshot of scheduler running/queued work (observability). |
| `GET /api/dataplane/config`, `POST /api/dataplane/config` | Process-local dataplane policy read/update, synced from browser-local Settings. Does not itself read the Kubernetes API. |

---

## 5. Design summary

For the main **namespaced list** read surfaces used as UI anchors (workloads, services, networking, storage, config, secrets, serviceaccounts, roles, rolebindings, Helm releases, quotas, and limit ranges), **dataplane snapshots** are the default substrate, with **list metadata** on each migrated list. **Namespace summary** is **projection-led** from those snapshots and preserves partial/degraded metadata instead of converting usable partial visibility into a hard failure. Remaining handler-level kube reads are **limited, intentional exceptions** (details, events, YAML, relations, Helm chart catalog reads, cluster-scoped families).

Derived projections are allowed only when explicitly labeled as derived/sparse/inexact. They may infer useful views such as node workload rollups from cached pod snapshots or chart catalog rows from cached Helm release snapshots, but they must not be represented as direct Kubernetes list results. When a canonical route serves a derived fallback, it must preserve the normal resource identity and deep-link target while making the fallback source visible in the payload/UI.

---

## 6. Maintenance checklist

1. Classify the new route: snapshot list, custom dataplane shape, projection, or direct exception.
2. Update **this file** in the same PR if the route is user-facing under `/api`.
3. Do **not** add silent `kube` calls inside projection code paths; keep exceptions visible in handlers (or confined to dataplane snapshot executors for list data).
