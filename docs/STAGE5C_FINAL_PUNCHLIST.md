# Stage 5C final punchlist (pre–5D)

Execution order from the punchlist spec:

1. **Prompt 01** — Remaining namespaced workload list migration *(this doc §1)*
2. **Prompt 02** — Namespace list enrichment / namespace-row projection
3. **Prompt 03** — Cluster dashboard bounded overview
4. **Prompt 04** — Consistency and cleanup pass

Suggested commits map to those prompts when work is still outstanding.

---

## 1. Prompt 01 — Namespaced workload list migration

### Status: **already complete** in this branch

An audit of `internal/server/server.go` shows **no** direct `kube.List*` calls for these list routes. Each uses `DataPlaneManager.*Snapshot` and `writeDataplaneListResponse`, matching pods/deployments/services/etc.

| Endpoint | Dataplane API |
|----------|----------------|
| `GET /api/namespaces/{ns}/daemonsets` | `DaemonSetsSnapshot` |
| `GET /api/namespaces/{ns}/statefulsets` | `StatefulSetsSnapshot` |
| `GET /api/namespaces/{ns}/replicasets` | `ReplicaSetsSnapshot` |
| `GET /api/namespaces/{ns}/jobs` | `JobsSnapshot` |
| `GET /api/namespaces/{ns}/cronjobs` | `CronJobsSnapshot` |

`kube.ListDaemonSets` (and siblings) are invoked only from **`internal/dataplane/manager.go`** snapshot executors (`fetch: kube.List…`), which preserves scheduler/cache/normalized-error semantics.

### Intentionally **not** in Prompt 01 scope

These namespaced **list** routes remain **direct** handler reads (deferred / different wave):

- `serviceaccounts`, `roles`, `rolebindings`, `helmreleases` (+ cluster `helmcharts`)

See `docs/STAGE5C_READ_SUBSTRATE.md` §4.

### Tests

Existing coverage includes `internal/dataplane/workload_snapshots_test.go` (snapshot wiring). List response envelope: `internal/server/dataplane_list_response_test.go`.

### Follow-up

If Prompt 01 is re-run on an older branch, use this file + `STAGE5C_READ_SUBSTRATE.md` as the acceptance checklist.

---

## 2. Prompt 02 — Namespace list row projection

### Status: **implemented** (see branch history)

Bounded per-row metrics on `GET /api/namespaces`, `NamespacesTable` columns, `internal/dataplane/namespace_list_row.go`.

---

## 3. Prompt 03 — Cluster dashboard bounded overview

### Status: **implemented**

`DashboardSummary` returns `visibility`, `resources`, `hotspots`, and `workloadHints` (see `internal/dataplane/dashboard.go`, `dashboard_aggregate.go`). UI: `DashboardView.tsx` four sections.

---

## 4. Prompt 04 — Consistency / cleanup pass

### Status: **implemented**

- **Coarse state:** dashboard uses shared `CoarseState` (removed duplicate `dashboardCoarseStateFromSnap`).
- **Namespace summary:** `NamespaceSummaryProjection` on `DataPlaneManager`; server calls `s.dp.NamespaceSummaryProjection` (no type assertion).
- **List UI:** `DataplaneListMeta` + `dataplaneListMetaFromResponse`, `ResourceListFetchResult`, `useListQuery` + `ResourceListPage` render `DataplaneListMetaStrip`; dataplane-backed namespaced lists pass meta; direct-read lists return `{ rows }` only.
- **Chips:** `dataplaneCoarseStateChipColor` centralizes coarse state colors (`namespaceRowSummaryStateColor` delegates); `DataplaneStatus` + namespace drawer summary use it.

`internal/dataplane/dashboard_test.go` removed when deduplicating (coarse mapping still covered via `state_test` / projection tests).
