# Shared Dataplane Explanation Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Give operators one reusable, read-honest explanation of what cached dataplane metadata means and why a surface is fresh, partial, stale, blocked, or unknown.

**Architecture:** Compose surface-owned quality metadata with a lazy, active-context runtime snapshot. The runtime endpoint must only inspect already-loaded manager state and must never create a plane, hydrate persistence, start observers, schedule work, or call Kubernetes. A shared UI model and dialog render the same vocabulary across resource lists first, then Dashboard and Resource Map adapters without creating a parallel diagnostics subsystem.

**Tech Stack:** Go 1.26 dataplane/server contracts, React 19 + TypeScript + MUI, Vitest/Testing Library, existing context-aware API client.

---

## Product Contract

1. **Read honesty:** explanation describes evidence already held by the requesting surface and runtime state already loaded in memory. Opening it performs no Kubernetes or Helm read.
2. **Context isolation:** runtime data is filtered to the exact active context. The endpoint requires a nonempty explicit context, validates it through the local context manager, and echoes it. An empty context does not request data; a response for another context is discarded.
3. **Absent state is unknown:** an unloaded plane, absent observer state, absent scheduler history, or unavailable sweep is shown as unavailable/not loaded, never as healthy, complete, or disabled unless policy proves disabled.
4. **Surface ownership:** list metadata, Resource Map family coverage/cache metadata, and Dashboard visibility remain authoritative for their own projections. Runtime metadata explains environment/profile/pressure; it does not overwrite surface facts.
5. **Lazy lifecycle:** compact status remains visible without another request. Runtime explanation is fetched only when the operator opens the explanation dialog.
6. **No parallel storage:** no persistence schema, hidden metadata database, or new background observer is introduced.
7. **Bounded output:** one active-context response, at most the fixed observer set plus one scheduler/pressure/sweep record.
8. **Truthful error handling:** endpoint failure preserves local surface metadata and marks runtime explanation unavailable.

## Target API

```http
GET /api/dataplane/explanation
X-Kview-Context: <active-context>
```

The following is an **abbreviated response example**; optional runtime fields are
omitted so the architecture contract stays readable.

```json
{
  "active": "dex-context-lux",
  "item": {
    "loaded": true,
    "profile": "balanced",
    "observers": [
      {"kind": "namespaces", "enabled": true, "state": "active"},
      {"kind": "nodes", "enabled": true, "state": "active"}
    ],
    "scheduler": {
      "state": "healthy",
      "backgroundAdmission": "open",
      "consecutiveFailures": 0,
      "recentFailures": 0,
      "recentSuccesses": 4
    },
    "pressure": {
      "running": 0,
      "queued": 0,
      "maxSlots": 4,
      "lowPriorityQueued": 0,
      "longestQueueWaitMs": 0
    },
    "namespaceSweep": {
      "enabled": true,
      "totalNamespaces": 12,
      "cachedEnrichmentNamespaces": 10,
      "noCachedEnrichmentNamespaces": 2,
      "cachedHotNamespaces": 6,
      "cachedWarmNamespaces": 2,
      "cachedColdNamespaces": 1,
      "cachedStaleNamespaces": 1,
      "cachedUnknownNamespaces": 0,
      "enrichedNamespaces": 3,
      "staleNamespaces": 1,
      "neverScannedNamespaces": 7,
      "systemNamespacesSkipped": 2,
      "pausedReason": "eligible when idle"
    }
  }
}
```

Optional blocks and observer `state` are omitted when there is no already-loaded
evidence. `loaded: false` is valid and must not mutate manager state. The endpoint
is observational background traffic and must not update the user-activity idle
gate used by namespace enrichment.

Namespace sweep cache coverage and current-process sweep history are separate
evidence. The `cached*` fields describe summaries available in the cache and
their freshness. `enrichedNamespaces`, `staleNamespaces`, and
`neverScannedNamespaces` describe only sweep records held by the current runtime;
they do not prove that a cached summary is present or absent.

---

### Task 1: Refresh roadmap state and pin the contract

**Objective:** Mark Resource Map v2 plus the Helm extension complete locally and make Shared Dataplane Explanation the active pack.

**Files:**
- Modify: `docs/ROADMAP.md`
- Create: `docs/plans/2026-09-01-shared-dataplane-explanation.md`

**Steps:**
1. Update the active post-v5.16 sequence and Resource Map status without claiming a push or release.
2. Link this plan from the roadmap.
3. Run `git diff --check`.

### Task 2: Add a cache-only active-context runtime contract

**Objective:** Return already-loaded runtime explanation without triggering any dataplane lifecycle or upstream read.

**Files:**
- Create: `internal/dataplane/explanation.go`
- Modify: `internal/dataplane/observer.go`
- Modify: `internal/dataplane/manager.go`
- Modify: `internal/server/handlers_dataplane.go`
- Modify: `internal/server/middleware.go`
- Test: `internal/dataplane/explanation_test.go`
- Test: `internal/server/server_http_test.go`

**TDD steps:**
1. Add failing manager tests proving absent-plane explanation returns `loaded: false` and leaves `manager.planes` unchanged.
2. Add a provider that panics on client access and prove explanation never reaches it.
3. Fix `setObserverState` so writes and explanation/dashboard reads synchronize on `obsMu`; add focused race coverage.
4. Seed two contexts and prove observers, scheduler health/pressure, work identities, and sweep are filtered to the requested context.
5. Implement a read-lock plane peek and fixed observer snapshot. Reuse effective policy and existing runtime DTO values; do not call `PlaneForCluster`, `EnsureObservers`, snapshot methods, persistence hydration, or scheduler methods that synthesize state.
6. Add authenticated handler coverage for required/validated context, unavailable dataplane, active-context propagation, and response shape.
7. Classify the endpoint as observational/background in middleware so opening it does not call `NoteUserActivity` or delay sweep eligibility.
8. Add a source/AST guard for forbidden lifecycle calls in the explanation implementation.
9. Run focused `go test -race` plus `go test ./internal/dataplane ./internal/server` in the pinned build container.

### Task 3: Add the shared frontend explanation model

**Objective:** Normalize surface metadata and runtime metadata into stable sections and operator-facing reasons.

**Files:**
- Modify: `ui/src/types/api.ts`
- Create: `ui/src/components/shared/dataplaneExplanationModel.ts`
- Test: `ui/src/components/shared/dataplaneExplanationModel.test.ts`

**TDD steps:**
1. Test list metadata states: hot/full/complete, stale but complete, partial, access degradation, and unknown.
2. Test that stale is independent from completeness and does not become unknown automatically.
3. Test absent runtime blocks as `Not loaded`, not `Healthy`.
4. Test fixed ordering and concise labels for profile, snapshot, observer, scheduler, and sweep sections.
5. Implement pure adapters with no fetching or React state.

### Task 4: Build the reusable lazy explanation dialog

**Objective:** Let a compact surface open detailed, context-safe runtime explanation without hiding caller metadata on failure.

**Files:**
- Create: `ui/src/components/shared/DataplaneExplanationDialog.tsx`
- Test: `ui/src/components/shared/DataplaneExplanationDialog.test.tsx`

**TDD steps:**
1. Mount closed and prove zero requests.
2. Open with empty context and prove zero requests plus an unavailable explanation.
3. Open with a context and prove exactly one `GET /api/dataplane/explanation` carrying that context.
4. Switch context while a request is pending and prove stale completion is ignored.
5. Prove endpoint failure leaves local surface metadata visible and only runtime state unavailable.
6. Render compact section summaries with expandable evidence/reasons; avoid wide tables and horizontal scrolling.

### Task 5: Integrate every dataplane resource list

**Objective:** Upgrade the existing shared metadata strip so all dataplane-backed lists receive the explanation workflow without per-resource duplication.

**Files:**
- Modify: `ui/src/components/shared/DataplaneListMetaStrip.tsx`
- Modify: `ui/src/components/shared/ResourceListPage.tsx`
- Test: `ui/src/components/shared/DataplaneListMetaStrip.test.tsx`
- Test: `ui/src/components/shared/ResourceListPage.test.tsx` or the nearest existing mounted list-page test

**TDD steps:**
1. Prove the compact chips retain current labels and wrapping.
2. Add one accessible **Explain** action when metadata exists.
3. Pass token and active context through the shared page, not every resource table.
4. Prove opening the dialog is lazy and uses the current list metadata.
5. Prove lists without dataplane metadata render no explanation action.

### Task 6: Add Dashboard and Resource Map adapters

**Objective:** Reuse the same explanation dialog while preserving each projection's own metadata semantics.

**Files:**
- Modify: `ui/src/components/resources/dashboard/DashboardView.tsx`
- Modify: `ui/src/components/shared/ResourceMapPanel.tsx`
- Create or modify focused adapter tests beside these components

**Steps:**
1. Adapt Dashboard `visibility`/`coverage` without calling the dashboard endpoint from the dialog.
2. Adapt Resource Map cache/family coverage/truncation without flattening edge-family reasons into list semantics.
3. Keep diagnostic evidence collapsed by default.
4. Verify normal/full-screen and stacked-drawer rendering.

### Task 7: Documentation and final verification

**Objective:** Document the operator workflow and verify the coherent feature boundary.

**Files:**
- Modify: `docs/user/resource-lists.md` or the authoritative resource-list help page discovered during implementation
- Modify: `docs/user/dashboard-and-signals.md`
- Modify: `docs/user/resource-drawers.md`
- Modify: `docs/DATAPLANE.md`
- Modify: `docs/API_READ_OWNERSHIP.md`

**Steps:**
1. Document freshness versus completeness, explicit unknowns, RBAC/scheduler/sweep explanations, and no-live-read behavior.
2. Run focused Go/UI tests, TypeScript typecheck, and ESLint.
3. Run `make check DOCKER_BUILD=0` once.
4. Run `make build DOCKER_BUILD=0` once.
5. Run an independent read-only review focused on cache-only behavior, context isolation, and error truthfulness.
6. Visually verify constrained-width list, Dashboard, normal Resource Map, and full-screen Resource Map.
7. Leave the tranche uncommitted until Alex explicitly approves the visual result and local commit.

---

## Acceptance Matrix

- Absent plane: `loaded: false`; no manager plane created.
- Persistence available but not hydrated: remains absent; no hydration.
- Observer policy disabled: explicitly `disabled`.
- Observer enabled but no state: `not_loaded`/unknown.
- Scheduler has no exact-context record: omitted/unknown, never synthesized healthy.
- Other contexts loaded: never included.
- Opening explanation does not update the user-activity idle gate.
- Surface metadata remains visible if runtime fetch fails.
- Dialog request timing: zero while closed, one on open.
- Context switch: stale response cannot render.
- UI remains compact and wraps at constrained widths.
- No Kubernetes/Helm client call, scheduling, observer start, or refresh occurs when explanation opens.

## Status

- [x] Foundation audit and architecture contract.
- [x] Task 1 roadmap update.
- [x] Task 2 cache-only backend contract.
- [x] Task 3 shared frontend model.
- [x] Task 4 lazy explanation dialog.
- [x] Task 5 resource-list integration.
- [x] Task 7 first-tranche docs, full gates, independent reviews, and constrained-list visual smoke.
- [x] Task 6 Dashboard/Resource Map adapters, adapter-specific docs, focused tests, and full gates.
- [x] Dashboard/Resource Map visual acceptance by Alex.
- [x] Alex authorized the local commit; push/release remain separate approval boundaries.
