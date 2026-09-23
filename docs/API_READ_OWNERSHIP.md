# API read ownership

This document maps how **GET** and read-shaped **`/api`** routes source data. It is maintained against `internal/server/server.go` and `internal/dataplane`. When you add or change a user-facing read route, update this file in the same change.

---

## Principles

1. **Dataplane snapshots** are the default substrate for the main list surfaces the UI uses as anchors.
2. **Projections** assemble answers from those snapshots (and metadata composition only)—**no** hidden live `kube` calls inside projection builders.
3. **Direct Kubernetes reads** in handlers are **explicit exceptions**: details, events, YAML (where present), relation lookups, deferred catalogs, custom-resource discovery helpers, and selected namespace helpers.

Underlying **list IO** for snapshot-backed routes is still `kube.List*` **inside** dataplane snapshot executors (scheduler, cache, normalization)—not in the HTTP handler.

---

## 1. Dataplane snapshot–backed (list envelope)

These routes use `DataPlaneManager.*Snapshot` and `writeDataplaneListResponse`. Each response includes `active`, `items`, `observed`, and `meta` (`freshness`, `coverage`, `degradation`, `completeness`, `state`).
Dataplane-backed read endpoints accept optional `X-Kview-Context`; when absent, they fall back to the process active context for backwards compatibility.

| Route pattern | Snapshot / notes |
|---------------|------------------|
| `GET /api/nodes` | `NodesSnapshot`; cluster-scoped list. If direct node list is denied/unavailable and cached pod snapshots exist, returns explicitly marked derived node rows from cached pod snapshots instead. Rows may include CPU/memory `usage` (and percent of allocatable) overlaid from cached `NodeMetricsSnapshot` when metrics.k8s.io is installed/allowed and the policy enables it. |
| `GET /api/clusterroles` | `ClusterRolesSnapshot`; cluster-scoped RBAC list with projection-derived privilege breadth hints. |
| `GET /api/clusterrolebindings` | `ClusterRoleBindingsSnapshot`; cluster-scoped RBAC list with projection-derived subject breadth hints. |
| `GET /api/customresourcedefinitions` | `CRDsSnapshot`; cluster-scoped CRD list with projection-derived established/attention hints. |
| `GET /api/persistentvolumes` | `PersistentVolumesSnapshot`; cluster-scoped storage list with projection-derived health hints. |
| `GET /api/namespaces/{ns}/pods` | `PodsSnapshot`; rows may include projection-derived fields (`restartSeverity`, `listHealthHint`) from `EnrichPodListItemsForAPI`, plus aggregated CPU/memory `usage` (and percent of request/limit) overlaid from cached `PodMetricsSnapshot` when metrics.k8s.io is installed/allowed and the policy enables it. |
| `GET /api/namespaces/{ns}/deployments` | `DeploymentsSnapshot`; optional `EnrichDeploymentListItemsForAPI` fields. |
| `GET /api/namespaces/{ns}/daemonsets` | `DaemonSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/statefulsets` | `StatefulSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/replicasets` | `ReplicaSetsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/jobs` | `JobsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/cronjobs` | `CronJobsSnapshot`; optional projection-derived `healthBucket` / `needsAttention` fields. |
| `GET /api/namespaces/{ns}/horizontalpodautoscalers` | `HPAsSnapshot`; list rows include HPA status, current metrics, replica bounds, and attention hints from cached snapshot data. |
| `GET /api/namespaces/{ns}/services` | `ServicesSnapshot` |
| `GET /api/namespaces/{ns}/ingresses` | `IngressesSnapshot` |
| `GET /api/namespaces/{ns}/networkpolicies` | `NetworkPoliciesSnapshot` |
| `GET /api/namespaces/{ns}/persistentvolumeclaims` | `PVCsSnapshot` |
| `GET /api/namespaces/{ns}/configmaps` | `ConfigMapsSnapshot` |
| `GET /api/namespaces/{ns}/secrets` | `SecretsSnapshot` |
| `GET /api/namespaces/{ns}/serviceaccounts` | `ServiceAccountsSnapshot` |
| `GET /api/namespaces/{ns}/roles` | `RolesSnapshot` |
| `GET /api/namespaces/{ns}/rolebindings` | `RoleBindingsSnapshot` |
| `GET /api/namespaces/{ns}/helmreleases` | `HelmReleasesSnapshot`; backed by Helm's Secret storage in the namespace. |
| `GET /api/namespaces/{ns}/resourcequotas` | `ResourceQuotasSnapshot`; also feeds namespace row quota pressure and dashboard signals. |
| `GET /api/namespaces/{ns}/limitranges` | `LimitRangesSnapshot`; also feeds namespace row limit-range count and dashboard totals. |
| `GET /api/namespaces/{ns}/podmetrics` | `PodMetricsSnapshot` (metrics.k8s.io); rows expose per-container CPU/memory usage. Returns the standard list envelope; absent metrics-server or RBAC denial surfaces via the metadata `state` and the capability endpoint. |
| `GET /api/nodemetrics` | `NodeMetricsSnapshot` (metrics.k8s.io); cluster-scoped node usage rows. Same access-denied behavior as `podmetrics`. |

---

### Pod refresh intent

`GET /api/namespaces/{ns}/pods` accepts optional `refresh=manual|auto|revision`;
unknown values return `400`. The UI supplies its active `X-Kview-Context` for
both Pod and metrics requests. The list route retains the existing authenticated
context-selection contract (including the legacy absent-header fallback).

Only `manual` can bypass a fresh Pod snapshot, and only when effective policy
`ManualRefreshBypassesTTL` permits it. Scheduler admission and context/kind/
namespace deduplication remain in force; failure preserves usable cached rows
with stale/error metadata. The marker does not force other resource families.

Absent intent and `auto` use ordinary TTL-aware snapshot reads.
`refresh=revision` now reads only an existing Pod snapshot, requires an explicit
context and namespace, returns `503` when the cache is absent, and neither starts
observers nor warms metrics. The revision check endpoint also remains cache-only.
The Pod page polls source snapshots independently of metrics outside Live mode;
metrics requests run separately and cannot hold up the first Pod render or status
updates.

### Workload refresh intent

The six workload list routes (`deployments`, `statefulsets`, `daemonsets`,
`replicasets`, `jobs`, and `cronjobs`) also accept `refresh=manual|auto|revision`.
Manual intent uses the effective `ManualRefreshBypassesTTL` policy and existing
scheduler bounds; absent intent and `auto` retain ordinary snapshot behavior.
Unlike the Pod route, these workload wrappers do not reject unknown intent
values; unrecognized values take the ordinary list path.

For all six, `refresh=revision` branches before observer admission and snapshot
execution. It requires an explicit exact context and a valid nonempty namespace,
reads only an existing in-memory snapshot, and returns `503` on a cache miss.
It does not create/hydrate a plane, start observers, schedule a LIST, warm metrics,
or fetch Events/details. Existing response enrichment is cache-only.

### Live Pod and workload streams

`GET /api/namespaces/{ns}/pods/live` uses SSE (`event: pods`) with JSON state and
revision notifications. It requires the app Bearer token in the Authorization
header and an explicit exact `X-Kview-Context`; query-token authentication is
rejected. The selected namespace must be valid and nonempty.

`GET /api/namespaces/{ns}/{kind}/live` is additionally registered only for
`deployments`, `statefulsets`, `daemonsets`, `replicasets`, `jobs`, and `cronjobs`.
These use `event: resource` with the same state/revision fields plus exact
`resource` and `scope: "Namespaced"`; Pods retain the original `event: pods`
wire shape. Both contracts use the authentication and exact-scope requirements
above. There is no generic arbitrary-kind, all-namespace, or cluster-wide Live
endpoint. HPA and other resource families are not enabled.

Each stream owns a bounded subscription to a shared exact context/namespace/kind
initial LIST + WATCH. This is not accelerated LIST polling. Notifications follow
committed snapshots; browsers fetch rows through the same list route with
`refresh=revision` (cache-only). Per-kind publication ownership gates prevent
older ordinary LIST results from overwriting Live snapshots. Kubernetes uses
the selected context's existing credentials, not a privileged fallback. See
[Live list subscriptions](DATAPLANE.md#live-list-subscriptions) for worker bounds
and lifecycle.

Streams have a five-minute lease, fifteen-second heartbeat and bounded write
deadline. Disconnect or cancellation releases the subscription; server shutdown
closes Live workers. Capacity rejection returns `429` before streaming; later
upstream failures are explicit state events, not a healthy Live indication.
This is not event replay and does not promise delivery of every intermediate
resource state. Metrics, Events, and detail reads are independent of the watch
event path. CronJob Live maps resource/status data without fetching Events or
streaming event-derived schedule evidence.

The UI suspends ordinary polling and hides manual Refresh while Live is enabled;
turning Live off restores both. Hidden tabs pause; transient failures reconnect
with backoff. Blocked/stopped states do not silently fall back to source polling
or privileged reads. Green requires a non-stale stream revision actually applied
to the exact authenticated table identity, not merely an open connection. List
UID changes or removal invalidate the selected resource and its open drawer.

### Restricted custom-resource discovery

When the CRD snapshot reports Forbidden, custom-resource instance snapshots may
construct a temporary type index from API discovery plus exact CRD GETs, using
the active context's existing credentials. The authoritative CRD list and resolve
endpoint are unchanged. Discovery alone never proves CRD backing.

The fallback bounds metadata work to 64 groups and 64 candidate CRD probes,
sequential requests, three-second request timeouts and an eight-second discovery
deadline. Only matching CRD identities/scopes with the advertised version marked
served become instance-list targets. Namespaced fallback requires an explicit
namespace; it never retries at all-namespaces scope.

`aggregation.discovery` records the denied list, unknown universe, probe outcomes
and truncation. Snapshot and kind-definition relationship coverage remain partial;
confirmed-kind counts do not represent the cluster's complete inventory. Restricted
results use the ordinary snapshot TTL and are not persisted as successful full
snapshots. See `internal/kube/resource/customresources/CORRECTNESS.md` for the
contract and limitations, including preferred-version-only discovery and the
requirement for individual CRD GET permission.

## 2. Dataplane snapshot–backed (custom JSON shape)

| Route | Behavior |
|-------|----------|
| `GET /api/namespaces` | Returns `NamespacesSnapshot` list immediately with `rowProjection.revision` / `loading`. Background stages enrich a scored subset: live **GET** per selected namespace (`GetNamespaceListFields`), then **pods + deployments** snapshots at low priority. If the namespace list order and target set are unchanged, the existing enrichment revision is reused so enriched rows remain stable across refreshes. Target namespaces are **scored from optional query hints**, not an alphabetical walk of the full list (see §2.1). UI polls `GET /api/namespaces/enrichment?revision=…`. |
| `GET /api/dashboard/signals` | Signal-only cached dashboard projection: visibility/coverage readiness metadata, filtered/paged `signals`, and derived node/Helm triage rows. It omits resource totals, usage, and dataplane runtime statistics. `POST /api/dashboard/signals/query` adds local Resource Tags matching without changing read ownership. |
| `GET /api/dashboard/dataplane` | Dataplane-only dashboard projection: plane/scope, visibility, coverage, resource totals, cached metrics usage, cache traffic, and scheduler statistics. The handler activates observers, may refresh cold/stale namespace and node snapshots, and asynchronously warms node metrics; it is not a cache-only explanation endpoint. Signal detection/history/sorting are skipped and signal/derived payloads are omitted. |
| `GET /api/dashboard/cluster` | Legacy compatibility projection combining Signals and Dataplane sections through `DashboardSummary`; existing clients and `POST /api/dashboard/cluster/query` retain the prior response shape. Detector output is collected into one request-local signal store indexed by resource kind/name/scope/location. |
| `GET /api/namespaces/enrichment?revision=` | Server-side merge for progressive namespace list rows (same revision as `GET /api/namespaces`). Includes `enrichTargets` (count of namespaces in the scored enrichment subset). Reflects in-process background work, not a direct kube call. |
| `GET /api/dataplane/search?q=…` | Cached quick-access search over already-observed dataplane snapshots for the active context, with `limit`/`offset` paging and `hasMore`. Matches resource name, namespace, kind, cluster, and cached list health/signal fields; result rows may include additive `healthBucket`, `signalSeverity`, `signalCount`, `needsAttention`, and `matchReason` fields. Prioritizes Helm releases, deployments, then ReplicaSets/DaemonSets/StatefulSets before other kinds. It does **not** perform live Kubernetes discovery; opening a result uses the normal resource detail drawer read. |
| `POST /api/dataplane/signals/exclusions/preview` | Read-shaped cache-only evaluation of draft per-signal exclusion rules. It rebuilds candidates from already-observed typed snapshots, matches private metadata without serializing annotation values, returns at most 100 matching resource identities, and never mutates policy, history, or Kubernetes resources. |

### Custom-resource aggregate and resolver shapes

- `GET /api/namespaces/{ns}/customresources` uses `CustomResourcesSnapshot`;
  `GET /api/customresources/instances` uses `ClusterCustomResourcesSnapshot`.
  Their custom envelope is `{active, items, meta, observed, dataplane}`: `meta`
  is kind aggregation/discovery evidence, while `dataplane` holds snapshot meta.
  They do not fetch per-object details or printer columns. The UI retains these
  cross-kind entry points and displays restricted/partial discovery evidence.
- `GET /api/customresources/resolve?group=…&kind=…` reads `CRDsSnapshot` and
  returns plural resource, storage version and scope. This is a snapshot access,
  not a guaranteed cache-only peek: normal snapshot refresh rules apply. It does
  not use the restricted discovery fallback. The drawer uses resolved plural/
  scope but preserves its reference's requested version.

### 2.1 Namespace list: enrichment hints, scoring, idle worker

Background row enrichment is **narrow and user-aligned**:

- **No alphabetical cluster scan** for enrichment targets. The handler takes the current list snapshot order from `NamespacesSnapshot` and intersects it with names implied by hints.
- **Optional query parameters** (`ParseNamespaceEnrichHints` in `internal/dataplane`):
  - `enrichFocus` — current namespace (UI selection).
  - `enrichRecent` — MRU names, comma-separated and/or repeated keys; earlier names rank as more recent.
  - `enrichFav` — favourite names, comma-separated and/or repeated keys.
- **Scoring** (`buildEnrichmentWorkOrder`): focus ≫ favourite ≫ recency; ties break by **snapshot list index** (stable).
- **Caps:** by default at most **32** focused namespaces receive GET + pods/deployments enrichment, up to **2** in parallel. These values are configurable through the dataplane policy with hard validation bounds.
- **Idle-only start:** by default the worker waits until the API has seen **no user activity** for **2s**. Activity is updated on `/api/*` except the background polling/control paths classified by `isBackgroundPollingPath`: namespace enrichment; status, activity, runtime logs, and sessions; dataplane revision, live work, explanation, config, signal catalog, and metrics status; and Dashboard signals/dataplane/cluster reads and query variants. Requests on these classified paths do not reset the idle timer.
- **Optional sweep:** if enabled in NS Enrichment settings, a tiny cold set outside focus/recent/favourites can be appended after a longer idle gate, constrained by per-cycle and per-hour caps. Sweep still uses dataplane snapshots and low-priority scheduler work; it is not a direct handler read or immediate full-cluster scan.
- **Stable refresh behavior:** repeated namespace list refreshes reuse the same enrichment revision when the namespace order and target set have not changed; refreshed base rows preserve already-enriched projection fields.

**UI:** the list URL is built in `ui/src/state.ts` as `namespacesListApiPath`, using persisted `recentNamespacesByContext` and `favouriteNamespacesByContext`. The Namespaces table passes that path into `fetchRows` so list load and hints stay aligned.

---

## 3. Projection-backed (no handler-level kube list for summary body)

| Route | Behavior |
|-------|----------|
| `GET /api/namespaces/{name}/summary` | `NamespaceSummaryProjection`: counts, health rollups, RBAC counts (serviceaccounts/roles/rolebindings), HPA count, Helm release count/list, `workloadByKind`, and `NamespaceSummaryMetaDTO` from dataplane namespace-scoped snapshots only. Returns a degraded/partial usable payload when at least one contributing snapshot is usable. |
| `GET /api/namespaces/{name}/insights` | `NamespaceInsightsProjection`: namespace summary plus sorted namespace-scoped signal rows under the `signals` JSON key, grouped `resourceSignals` keyed by resource identity, full `ResourceQuota` entries, and `LimitRange` items from dataplane namespace-scoped snapshots only. HPA warning signals are included when the HPA snapshot is available. When metrics.k8s.io is installed/allowed and the policy enables it, an optional `resourceUsage` block aggregates pod metrics for the namespace. Intended for the namespace drawer's observability-first view. |
| `GET /api/dataplane/resource-map` | Authenticated, bounded Resource Map projection for the active `X-Kview-Context` (or process active context). The query supplies the canonical target identity (`group`, `version`, plural `resource`, `kind`, exact `scope`, conditional `namespace`, `name`, optional `uid`) and optional `depth` (`0` through `ResourceMapMaxDepth`; `0` uses the dataplane default). It reads only already-observed in-memory snapshot cache cells and returns `ResourceMapResponse` directly. The handler never starts observers, resolves Kubernetes clients, performs live list/get/discovery calls, refreshes snapshots, or reads persistence. Safe to poll; cold or incomplete caches are represented by response coverage/availability metadata rather than hidden reads. |
| `GET /api/namespaces/{ns}/{kind}/{name}/signals` | `ResourceSignals` (namespace scope): dashboard/aggregate signals attributed to a single namespace-scoped resource, sourced exclusively from cached dataplane snapshots — no live kube reads, no metrics-server dependency. `kind` is the plural URL segment matching existing per-resource routes (`pods`, `deployments`, `helmreleases`, …). Returns `{signals, meta}` where `signals` is `[]NamespaceInsightSignalDTO` (always non-null) and `meta` carries worst freshness/degradation across the snapshots that fed detection. Detail-level signals computed from a resource's full `*DetailsDTO` are embedded by the per-kind detail endpoints; this endpoint only surfaces snapshot/aggregate signals. Safe to poll. |
| `GET /api/cluster/{kind}/{name}/signals` | `ResourceSignals` (cluster scope): same contract as above, for cluster-scoped resources (`nodes`, `persistentvolumes`, `clusterroles`, `clusterrolebindings`, `customresourcedefinitions`, `namespaces`). Currently only `Node` resources can produce signals (`node_resource_pressure`); other kinds return an empty `signals` array but still respond `200 OK`. Lives under the explicit `/cluster/` prefix to keep URLs unambiguous against the existing top-level cluster resource routes. |
| `POST /api/dataplane/signals/investigate` | Read-shaped signal investigation bundle. The handler accepts the selected signal, then composes `ResourceSignals` and, for namespace-scoped signals, `NamespaceInsightsProjection` into a read-only debug bundle with primary resource, same-resource signal evidence, weak namespace/same-type context signals, targeted checks, unavailable helper checks, and copyable Markdown. It also runs explicit read-only helpers for object-scoped Events, supported resource YAML checks, referenced Secret/ConfigMap/PVC/ServiceAccount availability checks, Service selector backing Pod checks, and a small Pod log tail scan for common failure patterns. It performs no cluster mutations. |

Signal-bearing projection responses can include additive local-memory fields
`observedDays7d`, `observedDays30d`, and `recurring`. These fields come from the
local dataplane signal-history store and count distinct observation days for the
stable signal identity; they do not perform Kubernetes reads or infer incident
resolution from absence.

Runtime suppression adds `stateFingerprint` to backend-identified signal rows.
Visible dashboard `signals` also adds the exact
`suppressed: {total, snoozed, untilChanged}` summary and a separately bounded
`suppressedItems` sample. Namespace insights and namespace/cluster resource
signal responses add `suppressedSignalCount` and `suppressedSignals`. These are
cache/local-state projections: suppression is applied after history and before
visible filters, counters, and pagination, with no live Kubernetes read. Invalid,
expired, unsupported, unavailable, or cancelled suppression state fails open and
does not remove the signal.

---

## 4. Local operator knowledge reads

These routes read kview-owned local state only. They do not call Kubernetes and
must remain safe in read-only/RBAC-constrained clusters.

| Route | Behavior |
|-------|----------|
| `GET /api/investigations/snapshots` | Lists local investigation snapshots for the active context, optionally filtered by primary resource `kind`, `namespace`, and `name`. Source is kview's local investigation snapshot store, not Kubernetes. The Settings transfer UI uses this route when exporting the explicit **Investigation snapshots** transfer section. |
| `GET /api/investigations/snapshots/{id}` | Returns one local investigation snapshot by id, or `404` if absent. Source is kview's local investigation snapshot store. |
| `GET /api/dataplane/signals/history/export` | Returns bounded local signal observation history for the active context. It performs no Kubernetes read. |
| `POST /api/dataplane/signals/history/import` | Imports bounded signal history for explicit contexts using the Settings transfer merge strategy. It mutates only kview's local dataplane persistence. |
| `POST /api/dataplane/signals/history/reset` | Removes one `historyKey`, or all local signal history for the active context when the key is omitted. It never mutates Kubernetes. |
| `POST /api/dataplane/signals/suppress` | Authenticated active-context mutation. Accepts `{historyKey, mode, durationSeconds?, baselineFingerprint?, comment?}`. `mode: "snooze"` requires `durationSeconds` of exactly `3600` or `86400` and no baseline; `mode: "until_changed"` requires a valid backend v1 `baselineFingerprint` and no duration. Returns `{active, historyKey, item}` with server-owned Unix-second timestamps. The body cannot select a context. |
| `DELETE /api/dataplane/signals/suppress` | Authenticated active-context **Show now** mutation. Accepts `{historyKey}` and returns `{active, historyKey, deleted: true}`. Deleting an absent key is idempotent. The body cannot select a context. |
| `GET /api/dataplane/signals/suppressions/export` | Returns `{active, items}` for valid, unexpired suppressions in the active context only. The item map is keyed by `historyKey`; records contain `mode`, Unix-second `createdAt`/`updatedAt`, optional `expiresAt` or `baselineFingerprint`, `fingerprintVersion`, and optional `comment`. |
| `POST /api/dataplane/signals/suppressions/import` | Accepts `{strategy, items}` for the active context only. Strategies are `keepMine`, `useImported`, and `replaceSections`; returns `{active, result: {imported, skipped, replaced}}`. Unknown fields and malformed records are rejected or skipped, persistence replacement is atomic, and no body field can target another context. |
| `DELETE /api/dataplane/signals/suppressions/reset` | Accepts an empty body or `{}` and resets all runtime suppressions for the active context, returning `{active, reset: true}`. Context-targeting fields are rejected. |

`POST` and `DELETE` on the same snapshot collection mutate only local kview
operator state; they do not write annotations or any other Kubernetes object.
Settings transfer import uses the same local mutation path for the explicit
**Investigation snapshots** section and applies duplicate handling in the UI
before saving imported records.

All suppression routes are authenticated with the normal `/api` middleware and
resolve the active context through the same request-context ownership as other
dataplane routes. They read or mutate only the dedicated local bbolt-backed
suppression store. See [DATAPLANE.md](DATAPLANE.md#runtime-signal-suppression) for
ordering and fail-open semantics, and
[Import / Export](user/import-export.md#signal-suppression-transfer) for the
operator transfer workflow.

---

## 5. Explicit direct-read exceptions (kube in handler)

### 5.1 Namespace helpers

| Route | Reason |
|-------|--------|
| `GET /api/namespaces/{name}` | Namespace **detail** for raw metadata/conditions/YAML (intentional direct read, lazy-loaded by the UI). |
| `GET /api/namespaces/{name}/events` | Aggregated namespace event list from Kubernetes Events in that namespace (intentional direct read, lazy-loaded by the UI). |

### 5.2 Deferred catalog reads

| Route | Reason |
|-------|--------|
| `GET /api/helmcharts` | Cluster-scoped Helm catalog; direct read. Rows are grouped by chart name and expose version rollups. If direct catalog read is denied/unavailable and cached Helm release snapshots exist, returns explicitly marked derived chart rows from cached Helm release snapshots instead. |
| `GET /api/helmcharts/{name}` | Cluster-scoped Helm chart detail; direct Helm release storage read for one chart name. Version details include exact release deployments and release-backed manifests when release storage is visible. If direct detail read is denied/unavailable and cached Helm release snapshots exist, returns explicitly marked derived details; the UI can still hydrate a selected release manifest through `GET /api/namespaces/{ns}/helmreleases/{name}` when that namespaced read is allowed. |

### 5.2.1 Guarded Helm recovery

`GET /api/namespaces/{ns}/helmreleases/{name}/recovery` is an explicit operator
preflight, not a background dataplane projection. It requires an exact
`X-Kview-Context`, reads Helm Secret history using the selected Kubernetes
identity, validates decoded release/storage identity, and returns only recovery
metadata and eligibility. It has no cache fallback and exposes no release data,
chart, values, or Secret bytes. Kubernetes list/get permissions are required;
delete permission and read-only mode affect eligibility.

`POST` to the same route is a guarded mutation, not a refresh. It repeats fresh
history/permission checks and compares expected revision, Secret name, UID and
resourceVersion. Typed confirmation and stopped-writer acknowledgement are
mandatory. Only one latest pending-upgrade/pending-rollback record with a usable
immediately preceding retained revision may be deleted. Kubernetes DELETE uses
both UID and resourceVersion preconditions; success requires a confirming read.
No Helm rollback/uninstall, resource mutation, chain deletion, export or backup
is implied. Successful deletion invalidates affected cached views.

Object preconditions do not lock external Helm/CI writers or the complete
release history. Operators must stop competing writers. Ambiguous identity,
corrupt/incomplete history, changed observations and uncertain authorization
fail closed.

### 5.3 Cluster-scoped detail families

| Routes (representative) | Notes |
|-------------------------|-------|
| `GET /api/nodes/{name}` | Node detail direct read. If direct detail is denied/unavailable and cached pod snapshots reference the node, returns an explicitly marked derived detail with pod rollups only. Node list uses `NodesSnapshot` or the derived fallback described above. |
| `GET /api/clusterroles/{name}`, events, yaml | RBAC cluster-scope detail surfaces; list is dataplane-backed. |
| `GET /api/clusterrolebindings/{name}`, events, yaml | RBAC cluster-scope detail surfaces; list is dataplane-backed. |
| `GET /api/customresourcedefinitions/{name}`, events, yaml | CRD cluster-scope detail surfaces; list is dataplane-backed. |
| `GET /api/persistentvolumes/{name}`, events, yaml | Storage cluster-scope detail surfaces; list is dataplane-backed. |

### 5.4 Detail, events, YAML, relations

For resources that have them, these remain **direct** `kube` reads:

- `GET …/{resource}/{name}` (detail)
- `GET …/{name}/events`
- `GET …/{name}/yaml` (**only where the route exists**)
- Relation reads, e.g. `GET …/pods/{name}/services`, `GET …/services/{name}/ingresses`
- `GET …/serviceaccounts/{name}/rolebindings`

Service detail relations and Service session target selection can perform direct
reads of `discovery.k8s.io/v1 EndpointSlice` objects. Cache-backed dashboard,
namespace, resource-attention, and investigation signals never perform detector-
triggered Kubernetes reads: Service selector evidence joins cached Pod labels,
while Service and Ingress endpoint evidence uses the observation state retained
by the Service snapshot executor. kview does not poll the deprecated
`core/v1 Endpoints` API for these paths. Unknown or incomplete Pod, Service, or
EndpointSlice coverage suppresses absence/failure claims instead of becoming a
zero count.

**Detail-level signals embedded in detail responses.** For drawers that have
been migrated to the signals-first concept (see `docs/UI_UX_GUIDE.md`), the
detail response envelope additionally carries a `detailSignals` array of
`NamespaceInsightSignalDTO` items derived from the resource's full
`*DetailsDTO` (and, where relevant, its events). These cover signals that the
namespace aggregator cannot produce because it works only off list snapshots
(e.g. Pod `pod_young_frequent_restarts`, `pod_succeeded_with_issues`). The UI
merges them with snapshot-level signals from `/{kind}/{name}/signals` for
display in `AttentionSummary`. The list of detail-level detectors lives in
`internal/dataplane/dashboard_detail_signals.go`. Currently embedded by:

- `GET /api/namespaces/{ns}/pods/{name}` → `detailSignals` from
  `DetectPodDetailSignals` (best-effort: an RBAC denial on the resource's
  events list silently suppresses event-derived signals rather than failing
  the detail response).
- `GET /api/namespaces/{ns}/deployments/{name}` → `detailSignals` from
  `DetectDeploymentDetailSignals`.
- `GET /api/namespaces/{ns}/daemonsets/{name}` → `detailSignals` from
  `DetectDaemonSetDetailSignals`.
- `GET /api/namespaces/{ns}/statefulsets/{name}` → `detailSignals` from
  `DetectStatefulSetDetailSignals`.
- `GET /api/namespaces/{ns}/replicasets/{name}` → `detailSignals` from
  `DetectReplicaSetDetailSignals`.
- `GET /api/namespaces/{ns}/jobs/{name}` → `detailSignals` from
  `DetectJobDetailSignals`.
- `GET /api/namespaces/{ns}/cronjobs/{name}` → `detailSignals` from
  `DetectCronJobDetailSignals`.

### 5.5 Generic custom-resource inspection and exact-kind browsing

All three routes below use `clientsForRequest`, the selected context's existing
credentials and request deadlines; the UI explicitly supplies Authorization and
`X-Kview-Context`. These are direct-read exceptions, not aggregate-cache or
projection enrichment. They neither populate aggregate CR snapshots nor add
per-object fan-out to aggregate lists.

| Route | Read ownership |
|-------|----------------|
| `GET /api/customresources/{group}/{version}/{resource}/{name}?namespace=…` | One exact dynamic-client GET. Returns summary UID/resourceVersion/generation/status observed generation, condition observed generations, raw JSON-valued Spec/Status and YAML with managed fields removed. Absent fields remain omitted, distinct from explicit null, empty, false and zero. No Events read is part of details. |
| `GET /api/customresources/{group}/{version}/{resource}/{name}/events?uid=…&namespace=…` | Required expected UID; first exact-object GET authorizes and verifies identity. Replacement returns `409`; missing UID returns `400`. Then a bounded core/v1 Events LIST with UID/kind/name/namespace selectors and post-filtering by group plus exact object identity. Namespaced objects stay in their namespace; cluster-scoped objects require all-namespace Events permission. |
| `GET /api/customresource-kinds/{group}/{version}/{resource}?scope=Namespaced\|Cluster&namespace=…&limit=…&continue=…` | Exact CRD GET (`{resource}.{group}`), then one page from the requested served GVR, negotiating `meta.k8s.io/v1 Table` with included objects. Requires exact CRD GET and CR LIST permissions, not CRD LIST. No discovery or storage-version substitution, no object GET fan-out and no dataplane snapshot read/write. |

The Events helper permits at most ten upstream pages of 500 Events. Errors,
denial, missing/replaced objects and exceeded bounds fail the request rather
than returning incomplete success or a known-empty result. Successful results
are filtered/paginated for the Events panel. There is no broad name-only fallback
or alternate privileged client. Events load lazily and independently; a failed
Events request leaves successful detail data intact. The drawer pins a supplied
or first-read UID and keys state by context/token/full reference identity;
obsolete detail, resolver and Events results cannot publish after cancellation.

Exact-kind scope is mandatory (`Namespaced` or `Cluster`); namespaced requests
require one explicit namespace, and cluster requests reject a namespace. The
CRD must match group/plural/scope and advertise the requested version as served.
The backend defaults to 200 rows and caps requests at 500, response bodies at
8 MiB and Table columns at 64. Continuation is caller-driven; a successful page
reports `columnSource`, `fallbackReason`, `continue`, `resourceVersion`,
`truncated`, `partial`, `unknownIdentityRows` and `incompleteCellRows` as applicable.

Only HTTP `406`/`415` retries Table negotiation as ordinary JSON; a directly
returned object list also uses standard columns (Name, Namespace, Age seconds).
That list must match the requested API version and CRD `spec.names.listKind`,
including custom list kinds (defaulting to `kind + "List"` only when absent).
Other errors are not disguised as printer fallback. Table cells are server
presentation data, not identities: included object/PartialObjectMetadata must
supply validated name, namespace and UID. Unknown identities remain visible but
non-actionable; unknown age in standard fallback stays null, not zero.

The per-kind UI offers manual Reload/Previous/Next (200 rows per page, at most
100 pages), page-local filtering and group/version/plural/scope-isolated column
preferences. It does not poll revisions, enable Live, or fetch each row's details.
Entry points are live aggregate Kind chips and served-version buttons in the CRD
list's drawer; manifest-only references do not establish per-kind identity.

### 5.6 Product and control-plane APIs

| Route | Substrate |
|-------|-----------|
| `GET /api/healthz`, `GET /api/status`, `GET /api/contexts` | Server / cluster manager; `/api/status` additionally performs a lightweight discovery version check for active cluster reachability. |
| `GET /api/activity`, `GET /api/activity/{id}/logs` | Runtime registry / logs. |
| `GET /api/sessions`, `GET /api/sessions/{id}` | Session manager. |
| `GET …/logs/ws`, `GET …/terminal/ws` | Streaming (not snapshot reads). |
| `POST /api/auth/can-i` | SSA review (write-shaped; authz read). |
| `POST /api/sessions/pod-debug` | Backend-owned mutating workflow: exact SSAR preflight, direct Pod GET, strategic patch of `pods/ephemeralcontainers`, and terminal session creation. The terminal WebSocket waits on ephemeral-container status and streams through `pods/attach`. Not a dataplane or projection route. |
| `GET /api/dataplane/revision` | Cheap list-cell revision metadata; does not schedule kube fetches. |
| `GET /api/dataplane/work/live` | In-process snapshot of scheduler running/queued work (observability). |
| `GET /api/dataplane/explanation` | Authenticated, explicit-active-context explanation of the effective dataplane profile and already-loaded observer, scheduler pressure, and namespace sweep state. It peeks only the exact loaded plane/runtime records, never creates or hydrates a plane, starts observers, schedules work, probes capabilities, or reads Kubernetes. Missing runtime evidence remains omitted/unknown; `loaded: false` is a valid response for a known context. Resource lists, the loaded Dashboard Dataplane tab, and loaded Kubernetes Resource Maps compose their own authoritative surface sections with this runtime response; opening the dialog does not repeat the dashboard or map projection request. |
| `GET /api/dataplane/config`, `POST /api/dataplane/config` | Process-local dataplane policy read/update, synced from browser-local Settings. Does not itself read the Kubernetes API. |
| `GET /api/dataplane/metrics/status` | Cluster metrics-server capability probe (`installed`, `allowed`) plus the policy `enabled` flag. Backed by a short-TTL cache so repeated UI mounts share one probe per cluster. UI uses this to gate metric widgets. |
| `GET /api/dataplane/signals/catalog` | Dataplane signal catalog derived from the effective process-local policy for the selected context. Does not itself read the Kubernetes API. |
| `GET /api/view/resources` | Backend-owned static resource/view descriptor bundle for list labels, icons, scope, access-review targets, sidebar grouping, list view policy, saved-view policy, dashboard signal-view/filter category presentation policy, and static action presentation hints. Does not read Kubernetes and is safe for the UI to cache/fallback locally. |

---

## 5. Design summary

For the main list read surfaces used as UI anchors (workloads, services, networking, policy, storage, config, secrets, serviceaccounts, roles, rolebindings, Helm releases, quotas, limit ranges, and supported cluster-scoped list families), **dataplane snapshots** are the default substrate, with **list metadata** on each migrated list. **Namespace summary** is **projection-led** from those snapshots and preserves partial/degraded metadata instead of converting usable partial visibility into a hard failure. Remaining handler-level kube reads are **limited, intentional exceptions** (details, events, YAML, relations, Helm chart catalog reads, exact-kind custom-resource browsing, and custom-resource discovery helpers).

Derived projections are allowed only when explicitly labeled as derived/sparse/inexact. They may infer useful views such as node workload rollups from cached pod snapshots or chart catalog rows from cached Helm release snapshots, but they must not be represented as direct Kubernetes list results. When a canonical route serves a derived fallback, it must preserve the normal resource identity and deep-link target while making the fallback source visible in the payload/UI.

---

## 6. Maintenance checklist

1. Classify the new route: snapshot list, custom dataplane shape, projection, or direct exception.
2. Update **this file** in the same PR if the route is user-facing under `/api`.
3. Do **not** add silent `kube` calls inside projection code paths; keep exceptions visible in handlers (or confined to dataplane snapshot executors for list data).
