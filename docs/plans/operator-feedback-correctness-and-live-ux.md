# Operator Feedback: Correctness and Live UX

## Approved sequence

Start from locally accepted Shared Dataplane Explanation (`1387128`). Work in
coherent verified tranches; new changes stay uncommitted until review. No push,
release, deployment, or real-cluster mutations are authorized by this plan.

1. Correct Pod refresh, generic CR health, and restricted-RBAC CR discovery.
2. Polish bounded Live Namespace observation, initially Pods (functional behavior
   is now user-confirmed; current changes remain uncommitted).
3. Make startup nonblocking after context selection; namespace/cache work must
   not hold the operator shell behind a modal.
4. Expand generic CR Details before operator-specific adapters.
5. Add guarded Helm Recovery, distinct from uninstall and rollback.

## Accepted boundary — 2026-09-16

The user accepted Refresh/Live and the improved browser reload, and authorized
committing tranches 1–3. First backend launch is still slower but acceptable;
further startup tuning is explicitly deferred, not declared solved. Full
`make check DOCKER_BUILD=0`, `make build DOCKER_BUILD=0`, and `git diff --check`
passed on the final code. No push, release, deployment or live mutation follows
from this approval. Next: generic CR Details, then guarded Helm Recovery.

The startup trace below records the initial investigation, not the final code.
Subsequent gated regressions justified private per-context hydration outside the
manager map lock, retained Pod startup snapshots with bounded revalidation,
background optional Events, idempotent normalized policy application and
mount-local serialized settings sync. Typed policy clones isolate all nested
mutable overrides. Read-only runtime diagnostics were subsequently authorized;
fast warmed GETs did not explain the user's slow config POST. The fixtures prove
specific defects, not complete attribution of the reported 1.2-minute POST and
36.5-second Pod GET. The latest user acceptance is the practical stopping point.

## Tranche 1 — current implementation

### Pod refresh

- Explicit manual refresh must honor `ManualRefreshBypassesTTL` through the
  authenticated, exact-context dataplane path; ordinary revision checks remain
  cache-only. Do not globally disable TTL or bypass scheduler bounds/dedup.
- Automatic refresh must advance source data without depending on metrics
  availability. Preserve explicit toolbar/policy semantics and avoid overlapping
  fetches or stale responses after context changes.
- Metrics must not delay first Pod rendering or status updates; failed or slow
  metrics must not erase usable Pod state.
- Preserve useful cached data on refresh failure without calling it fresh.
- Regression coverage: manual bypass on/off, automatic source refresh, slow or
  failed metrics, deduplication, context/namespace changes and request errors.

### CR health

- Interpret only recognized condition types with explicit positive/negative
  polarity. `Degraded=False` is not itself a failure, and `Degraded=True` must
  not be called healthy because another arbitrary condition is True.
- Compare observed generation to metadata generation where evidence exists.
- Unrecognized/missing/stale evidence must not fabricate readiness.
- Reuse one semantic implementation across list and detail projections.
- Cover contradictory conditions, unknown/missing conditions, stale generation,
  supported positive/negative conditions and legacy phase behavior.

### CR discovery

- Inspect safe fallback when listing CRDs is forbidden but reading CRs is allowed.
- Prefer served versions; preserve exact GVR, scope, context, RBAC and partial
  coverage. Never retry using more privileged credentials.
- Do not classify every non-core discovery resource as a CRD-backed resource:
  aggregated APIs and built-in groups require honest source distinctions.
- Bound discovery/list fan-out and report denied/error/incomplete evidence.
- Preserve existing CRD/owner relationship evidence and Helm-manifest provenance.
- If generic discovery cannot safely establish custom-resource identity, use a
  narrower supported fallback and explicitly document the limitation.

### Acceptance

- [x] Pod refresh implementation and causal regressions.
- [x] CR health implementation and causal regressions.
- [x] Restricted discovery implementation and causal regressions.
- [x] API ownership and user docs aligned with actual behavior.
- [x] Independent review of changed boundaries (Pod refresh and restricted CR
  discovery APPROVED; prior foreground-state and causal-coverage findings closed).
- [x] Focused tests and full `make check DOCKER_BUILD=0` +
  `make build DOCKER_BUILD=0` + `git diff --check` passed (2026-09-16).
  Verification used fixtures, not a real cluster.
- [x] User review and explicit commit permission received.

## Tranche 2 — Live Namespace

User approved visible Refresh plus Live toggle; the legacy interval selector is
intentionally hidden on revision-backed lists (`showRefresh: !dataplaneRevisionPoll`).
Do not mistake dormant toolbar code for visible controls or restore the selector
as a substitute for these actions.

Implementation contract: one stream-owned lease per visible Pod view, bounded
shared LIST/WATCH per exact context/namespace, coalesced SSE notifications, and
cache-only revision reads. Live and ordinary LIST publication share an ownership
epoch gate so an older request cannot overwrite newer watch state. Authorization
uses headers and the same Kubernetes credentials; no token query parameters.

- [x] Visible compact Refresh and mounted state-preservation regression.
- [x] Initial backend LIST/WATCH/SSE implementation; package checks passed.
- [x] Live functional behavior confirmed by the user.
- [x] Fit-content Live status chip and final focused verification.
- [x] Final integrated verification/review passed.
- [x] Separate commit permission received.

Use initial LIST + WATCH and an in-memory dataplane projection, not repeated
uncached full LIST requests. Favorite namespaces remain navigation/preferences,
not an automatic subscription to every favorite. Start with explicit Live mode
for the active namespace and Pods only. Bound subscribers, queues and lease
lifetime; reconnect/backoff and relist on expired resource versions. Preserve
UID identity, snapshot ordering and context generation guards. Push coalesced
revision notifications first; adopt row deltas only if measurements justify them.
Keep Events, metrics and persistence off the per-event critical path. Report
Live/Reconnecting/Paused/stale honestly and retain polling fallback. Measure
source-to-display latency and UI responsiveness separately; do not promise zero
latency or a fixed FPS without measurements.

## Tranche 3 — Nonblocking startup

User reports tens of seconds at **Loading namespaces and dataplane cache** /
**Starting observers and asking the dataplane for the namespace snapshot**.
The shell should be usable while that work runs; a namespace error must offer
retry without turning the entire application back into a startup dialog.

### Causal trace (source inspection, not live-cluster timing)

- `App.tsx` formerly awaited `fetchNamespacesWithWarmup` before changing
  `bootstrapPhase` to `ready`; `StartupDialog` stayed modal until then.
- Startup reads `GET /api/contexts`, then awaits authenticated
  `POST /api/context/select` with `{name}`. These select a configured context,
  not a namespace snapshot; migration status comes from the contexts response.
- Inventory uses `GET /api/namespaces` with `enrichFocus`, `enrichRecent` and
  `enrichFav` when present, via `apiGetWithContext` (Authorization and exact
  `X-Kview-Context` headers). Empty successful snapshots retry up to five times
  with 400 ms between requests; each request's latency is additional.
- Separately, `DataplaneSettingsSync` can issue a best-effort bare
  `GET /api/namespaces` after its 250 ms config-sync debounce, only for an enabled
  enrichment sweep. The Namespaces resource view can also issue its own list.
- `registerNamespaceRoutes` uses the 45-second `ctxTimeoutExec` and synchronously
  calls `EnsureObservers` then `NamespacesSnapshot`. First `PlaneForCluster`
  hydrates persisted snapshots and signal history under the manager lock;
  hydration does not itself honor that request deadline. Observer loops then
  launch in goroutines (the handler does not await observer completion).
- `NamespacesSnapshot` uses a critical-priority scheduled snapshot. A fresh cache
  can return immediately; a miss/stale snapshot can wait for scheduler admission,
  client acquisition and `CoreV1().Namespaces().List` (Kubernetes
  `GET /api/v1/namespaces`). A persisted fallback is returned only after a failed
  refresh. Cached row merging follows; progressive enrichment is launched, not
  awaited. There is no namespace-summary fan-out in this initial LIST path.

This proves why namespace/cache latency held the UI modal open. It does **not**
prove whether hydration, scheduler pressure, credentials/network or the live
namespace LIST caused the user's particular delay. At this initial investigation
stage, live diagnostics and backend hydration changes were deferred. Subsequent
read-only diagnostics and causal fixtures justified the scoped backend changes
recorded in the accepted-boundary section above; this historical trace must not
be read as a description of the final manager locking or startup snapshot path.

### Scoped implementation / acceptance

- Shell readiness now follows successful context selection. Namespace warmup is
  a separate background effect with a visible pending notice and retryable
  error/empty/restricted state. Namespace retry does not reselect the context.
- Keep context/no-context/authentication failures behind the existing startup
  guard. Keep authenticated exact-context requests and limited-list behavior.
- Abort obsolete namespace requests, stop further warmup retries on cancellation,
  and reject late success/error publication after context changes or unmount.
- Preserve navigation and explicit namespace choices made while warmup is pending.
  Inventory contains only server-returned names; the existing preferred-namespace
  route is not evidence of a discovered namespace or fresh resource data.
- Mounted regressions cover a deliberately unresolved namespace request, usable
  navigation, recovery/retry, stale-context success/failure, empty-snapshot warmup,
  unmount cancellation and failed context selection. These are fixtures, not an
  actual slow-cluster benchmark.
- [x] Focused pinned-container verification passed: `npm test --
  src/App.bootstrap.test.tsx src/App.test.tsx` (14 tests), `npm run typecheck`
  (app and e2e configs), ESLint on the two startup files, and `git diff --check`.
  Image: `kview-build:go1.26.6-node22.23.1`, host uid/gid, `HOME=/tmp`, repository
  mounted at `/workspace`, commands executed with `sh -c`; no dependency install.
- [x] User accepts current startup; further cold-start tuning deferred.
- [x] Broader final tranche gates and separate commit permission.

## Tranche 4 — Generic CR Details

Build on existing CR lists/details and Resource Map relationships. Add per-kind
navigation and printer columns, structured Spec/Status, generation evidence and
object Events. Preserve partial access and unresolved manifest references.
Do not label a generic summary as complete kubectl describe equivalence.
Operator-specific declarative adapters come later for concrete user operators;
no general executable plugin runtime in this tranche.

## Tranche 5 — Helm Recovery

Expose exact latest revision/status/description and storage Secret navigation.
Distinguish failed releases from active or abandoned pending operations. Present
existing rollback/retry with their semantics (including current hook behavior).
A break-glass revision-record deletion is not resource rollback or uninstall:
require typed confirmation, exact decoded release identity, fresh server-side
checks, read-only/RBAC enforcement and UID/resourceVersion preconditions. Do not
silently back up Secret material in logs/artifacts; any export is sensitive.
Preconditions cannot coordinate external Helm/CI writers: require stopping
competing operations. Initially exclude first-revision recovery without usable
prior history and never automatically delete a chain of revision records.
