# Signal Snooze Runtime Suppression Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add context-local, reversible per-signal Snooze 1 hour / 1 day and Ignore until changed workflows with honest suppressed counts across dashboard, namespace, and resource projections.

**Architecture:** Runtime suppressions are backend-owned records keyed by context plus the existing stable signal history identity. They are persisted separately from inherited signal exclusions, evaluated after static policy and history updates, and applied consistently before visible projections and counters. Ignore-until-changed uses a versioned backend-generated evidence fingerprint and always fails open for invalid or incompatible records.

**Tech Stack:** Go dataplane and bbolt persistence, Go HTTP handlers, React/TypeScript/MUI, Vitest, repository Docker toolchain.

**Out of scope:** Release/tag preparation, profile-inherited suppressions, bulk regex snooze rules, calendar-boundary snooze, Kubernetes live reads, and full UID propagation to every resource DTO.

---

## Durable contracts

- Runtime suppressions are context-local and never inherit global → context.
- Do not add expiry or fingerprint fields to `SignalExclusionRule`.
- Existing static exclusions remain configuration and continue to prevent history updates.
- Runtime suppressions are triage state and are evaluated after `attachSignalHistory`, so recurrence remains honest while hidden.
- One-hour and one-day snooze mean fixed durations of 3,600 and 86,400 seconds from backend UTC time.
- At `now >= expiresAt`, a snoozed signal is visible.
- Ignore-until-changed suppresses only when history identity and versioned evidence fingerprint still match.
- Fingerprint mismatch, unsupported fingerprint version, malformed record, or missing baseline fails open.
- Partial or stale cache absence is not a resolution and does not delete an until-changed record.
- Suppression must be visible: every signal surface reports counts and can show/restore suppressed entries.
- Persistence/import limits must match existing acknowledgement/history defensive conventions.

## Proposed backend records

```go
const signalFingerprintVersion = 1

const (
    SignalSuppressionModeSnooze       = "snooze"
    SignalSuppressionModeUntilChanged = "until_changed"
)

type SignalSuppressionRecord struct {
    Mode                string `json:"mode"`
    CreatedAt           int64  `json:"createdAt"`
    UpdatedAt           int64  `json:"updatedAt"`
    ExpiresAt           int64  `json:"expiresAt,omitempty"`
    BaselineFingerprint string `json:"baselineFingerprint,omitempty"`
    FingerprintVersion  int    `json:"fingerprintVersion"`
    Comment             string `json:"comment,omitempty"`
}

type SignalSuppressionRequest struct {
    HistoryKey          string `json:"historyKey"`
    Mode                string `json:"mode"`
    DurationSeconds     int64  `json:"durationSeconds,omitempty"`
    BaselineFingerprint string `json:"baselineFingerprint,omitempty"`
    Comment             string `json:"comment,omitempty"`
}
```

---

### Task 1: Lock suppression semantics with pure unit tests

**Objective:** Define clock boundaries, validation, fingerprinting, and fail-open behavior before persistence or HTTP wiring.

**Files:**
- Create: `internal/dataplane/signal_suppressions.go`
- Create: `internal/dataplane/signal_suppressions_test.go`
- Modify: `internal/dataplane/dashboard.go`

**Steps:**
1. Add failing table tests for active 1h/1d snooze, exact expiry boundary, invalid duration, unsupported mode, missing history key, and comment/key size limits.
2. Add failing tests for unchanged/changed fingerprints, severity changes, fingerprint-version mismatch, and missing baseline.
3. Define a canonical fingerprint from fingerprint version, signal type, effective severity, canonical scope/resource identity, normalized `ActualData`, and normalized `CalculatedData`; use `Reason` only when both evidence fields are empty.
4. Add `StateFingerprint` and optional suppression metadata to `ClusterDashboardSignal` without exposing internal persistence keys.
5. Implement pure normalization, validation, fingerprint, and active-record functions using an injected `now time.Time` in tests.
6. Run:
   ```bash
   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
     -e GOCACHE=/workspace/.cache/go-build -e GOMODCACHE=/workspace/.cache/go-mod \
     -v "$PWD:/workspace" -w /workspace kview-build:go1.26.6-node22.23.1 \
     sh -lc '/usr/local/go/bin/gofmt -w internal/dataplane/signal_suppressions*.go internal/dataplane/dashboard.go && /usr/local/go/bin/go test ./internal/dataplane -run SignalSuppression'
   ```
   Expected: PASS.

### Task 2: Add context-local bbolt persistence

**Objective:** Persist suppressions independently from signal history, acknowledgements, and policy.

**Files:**
- Modify: `internal/dataplane/manager.go`
- Modify: `internal/dataplane/persistence.go`
- Modify: `internal/dataplane/persistence_test.go`
- Modify: `internal/dataplane/signal_suppressions.go`
- Modify: `internal/dataplane/signal_suppressions_test.go`

**Steps:**
1. Add a dedicated signal-suppressions bucket and methods to `snapshotPersistence`:
   ```go
   LoadSignalSuppressions(cluster string) (map[string]SignalSuppressionRecord, error)
   UpsertSignalSuppression(cluster, key string, rec SignalSuppressionRecord) error
   DeleteSignalSuppression(cluster, key string) error
   PruneSignalSuppressions(cluster string, now time.Time, retention time.Duration) error
   ```
2. Add manager map/mutex ownership and lazy load behavior matching acknowledgements.
3. Implement create/replace/delete/list/export/import operations with `keepMine`, `useImported`, and `replaceSections` semantics.
4. Ensure expired records do not apply or export; lazy cleanup must not make the response fail.
5. Add bbolt restart round-trip, context isolation, overwrite, delete, expiry, invalid import, and merge-strategy tests.
6. Verify:
   ```bash
   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
     -e GOCACHE=/workspace/.cache/go-build -e GOMODCACHE=/workspace/.cache/go-mod \
     -v "$PWD:/workspace" -w /workspace kview-build:go1.26.6-node22.23.1 \
     sh -lc '/usr/local/go/bin/go test ./internal/dataplane -run "SignalSuppression|Persistence"'
   ```
   Expected: PASS.

### Task 3: Apply suppressions consistently after history updates

**Objective:** Produce one visible/suppressed decision model for dashboard, namespace, resource Attention, list health, counters, filters, and pagination.

**Files:**
- Modify: `internal/dataplane/signal_suppressions.go`
- Modify: `internal/dataplane/dashboard_aggregate.go`
- Modify: `internal/dataplane/dashboard_signals.go`
- Modify: `internal/dataplane/namespace_insights.go`
- Modify: `internal/dataplane/resource_signals.go`
- Modify: `internal/dataplane/namespace_list_row.go`
- Modify: `internal/dataplane/metrics_enrich.go`
- Modify: `internal/dataplane/dashboard_aggregate_test.go`
- Modify: `internal/dataplane/signal_exclusions_history_test.go`

**Steps:**
1. Introduce a result shape that returns visible signals, optionally exposed suppressed signals, and summary counts by mode.
2. Preserve processing order:
   ```text
   detectors
   → static policy/exclusions
   → attach history/acknowledgement
   → generate state fingerprint
   → apply runtime suppression
   → visible projections/counters
   ```
3. Ensure active Snooze hides only the exact `HistoryKey` in the exact context.
4. Ensure Ignore until changed wakes the signal in the same response when fingerprint changes.
5. Keep active suppressions when a signal disappears from an incomplete/partial cache; do not infer resolution.
6. Make dashboard, namespace, per-resource, Attention, list badges, totals, filters, and pagination use the same visible set.
7. Add tests proving history/recurrence updates while runtime-suppressed and does not update for static exclusions.
8. Add projection consistency tests for hidden count, show-suppressed mode, restored signals, exact expiry boundary, and changed fingerprint.
9. Run full dataplane tests in the pinned image; expected PASS.

### Task 4: Add authenticated HTTP CRUD and transfer endpoints

**Objective:** Expose validated context-local mutation and transfer APIs following acknowledgement/history conventions.

**Files:**
- Modify: `internal/server/handlers_dataplane.go`
- Modify: `internal/server/server_http_test.go`
- Modify: `internal/dataplane/signal_suppressions.go`

**Endpoints:**
- `POST /api/dataplane/signals/suppress`
- `DELETE /api/dataplane/signals/suppress`
- `GET /api/dataplane/signals/suppressions/export`
- `POST /api/dataplane/signals/suppressions/import`
- `DELETE /api/dataplane/signals/suppressions/reset`

**Steps:**
1. Reuse context ownership/authentication from ack/history handlers; never accept a different target context inside the JSON body.
2. Validate mode, exact duration allowlist, timestamps, fingerprint version, key/comment lengths, body size, record count, and import strategy.
3. Generate backend timestamps; never trust client `createdAt` for normal mutations.
4. Return a normalized record and force clients to refresh affected projections after mutation.
5. Add HTTP tests for authentication, invalid bodies, context isolation, create/replace/delete, exact expiry, export omission of expired records, import limits, and reset.
6. Run `go test ./internal/server ./internal/dataplane` in the pinned image; expected PASS.

### Task 5: Add shared signal action UI

**Objective:** Provide one compact Snooze menu across Dashboard, Namespace Signals, and resource Attention.

**Files:**
- Create: `ui/src/components/shared/SignalSuppressionButton.tsx`
- Create: `ui/src/components/shared/SignalSuppressionButton.test.tsx`
- Modify: `ui/src/components/shared/SignalActions.tsx`
- Modify: `ui/src/components/shared/signalIdentity.ts`
- Modify: `ui/src/types/api.ts`
- Modify: `ui/src/components/resources/dashboard/DashboardSignalsPanel.tsx`
- Modify: `ui/src/components/resources/namespaces/NamespaceSignalsTab.tsx`
- Modify: `ui/src/components/shared/AttentionSummary.tsx`

**Steps:**
1. Add one menu, not three new row icons: Snooze 1 hour, Snooze 1 day, Ignore until changed, optional comment, and Show now.
2. Require backend-provided `historyKey` and `stateFingerprint`; disable Ignore until changed when either is absent.
3. After mutation, invalidate/refetch the projection instead of relying only on local hidden-row state.
4. Display suppressed total and by-mode counts on all three surfaces.
5. Add Show suppressed toggle; exposed rows show mode, comment, and expiry/unchanged state plus Show now.
6. Ensure keyboard access, focus restoration, loading/error states, and no duplicate actions in Attention rows.
7. Add Vitest coverage for each action, exact payload, restore, failed mutation, disabled fail-open state, and refetch callback.
8. Run:
   ```bash
   docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
     -v "$PWD:/workspace" -w /workspace/ui kview-build:go1.26.6-node22.23.1 \
     sh -lc 'npm run typecheck && npm test -- --run SignalSuppressionButton'
   ```
   Expected: PASS.

### Task 6: Add settings transfer and operator documentation

**Objective:** Make suppressions explicitly portable while remaining outside operator profiles and inherited settings.

**Files:**
- Modify: `ui/src/settings.ts`
- Modify: `ui/src/settings.test.ts`
- Modify: `ui/src/components/settings/SettingsView.tsx`
- Modify: relevant Settings transfer tests
- Modify: `docs/ROADMAP.md`
- Modify: `docs/DATAPLANE.md`
- Modify: `docs/API_READ_OWNERSHIP.md`
- Modify: `docs/user/dashboard-and-signals.md`
- Modify: `docs/user/settings.md`
- Modify: `docs/user/import-export.md`

**Steps:**
1. Add `signalSuppressions` as its own optional transfer section, separate from dataplane policy and operator profiles.
2. Validate records and render import review counts without leaking records into global/context override settings.
3. Wire backend export/import and all merge strategies for the active context.
4. Document context locality, fixed duration semantics, fingerprint wake-up, fail-open behavior, stale/partial limitations, name-reuse limitation, restore workflow, and transfer ownership.
5. Do not update release notes, version numbers, tags, or release workflows in this tranche.
6. Run focused settings/UI tests and `git diff --check`; expected PASS.

### Task 7: Full verification and independent review

**Objective:** Prove the completed subsystem is consistent before deciding whether to add another functional tranche.

**Files:** All files changed above.

**Steps:**
1. Run focused Go and UI tests after every coherent slice.
2. Run:
   ```bash
   make check DOCKER_BUILD=0
   make build DOCKER_BUILD=0
   git diff --check
   ```
3. Independently review:
   - context isolation and auth boundaries;
   - exact clock boundary;
   - fail-open fingerprint behavior;
   - history versus static exclusion ordering;
   - consistency of counters/pagination/all projections;
   - bbolt/import defensive limits;
   - restore visibility and accessibility.
4. Fix important findings and rerun affected focused tests plus the full gate after production changes.
5. Stop at a verified functional checkpoint. Do not tag, publish, or prepare a release unless separately requested.
