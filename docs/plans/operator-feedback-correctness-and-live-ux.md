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
navigation and printer columns, read-only JSON Spec/Status, generation evidence and
object Events. Preserve partial access and unresolved manifest references.
Do not label a generic summary as complete kubectl describe equivalence.
Operator-specific declarative adapters come later for concrete user operators;
no general executable plugin runtime in this tranche.

### Approved implementation sequence

The user authorized continuing this tranche after commit `91f7244`. New work
remains uncommitted until separate approval; no live requests or mutations are
needed for fixture-based implementation.

User accepted tranche 4, including the shared JSON viewer correction, and
authorized its commit. Spec and quality reviews passed; full check/build passed
before the viewer correction, whose focused tests, typecheck, lint and final
binary build also passed. The accepted tranches 1–3 record above is unchanged.

- [x] Extend exact-object details with UID/resourceVersion, generation evidence,
  and JSON-valued Spec/Status preserving absent/null/empty/false/zero distinctions.
- [x] Independently load Events after server-side object/expected-UID verification.
  Namespaced reads stay scoped; cluster-scoped Events may require all-namespace
  permission. Denial, timeout and replacement must not masquerade as empty data
  or blank successful details.
- [x] Reuse the shared CodeBlock viewer for read-only JSON fragments. Pin exact
  context and full resource identity; cancel obsolete resolve/detail/Event reads
  and reject their late results. Preserve neutral raw conditions and YAML.
- [x] Add exact-kind navigation and printer columns without per-object detail
  fan-out in aggregate lists. Isolate column preferences by group/version/plural/
  scope, retain aggregate entry points, and expose standard-column fallback.
- [x] Cover RBAC, same-name replacement, cross-context responses, JSON edge cases,
  served-version identity, printer fallback and partial discovery with fixtures.
- [x] Align user/API docs with source-inspected drawer and per-kind behavior.
- [x] Complete spec review, then quality review and integrated checks/build.
- [x] Obtain user acceptance and separate commit permission for tranche 4.

### Current implementation boundaries

- `customresource_details.go` preserves JSON-valued Spec/Status and generation
  evidence; `CustomResourceDrawer.tsx` renders complete read-only JSON fragments
  through CodeBlock (plain text for large values),
  neutral raw conditions and existing YAML. It pins the supplied/first-read UID,
  retains the requested version, and cancels/guards obsolete identity reads.
- `customresource_events.go` verifies the exact object and expected UID before
  bounded core Events reads. Events load only on their tab and fail independently
  with retry; Forbidden, timeout, missing/replaced objects and exceeded bounds
  are errors, not known-empty evidence. Cluster-scoped objects need all-namespace
  Events permission. There is no broad name-only or privileged fallback.
- Aggregate Kind chips and CRD served-version buttons enter the exact-kind view.
  Namespaced browsing requires an explicit namespace; cluster scope omits it.
  `exact_kind.go` requires exact CRD GET plus CR LIST permission, validates the
  served GVR, negotiates Table printer columns, and exposes standard fallback
  with its reason. Ordinary lists honor custom CRD `spec.names.listKind`.
- `CustomResourceKindTable.tsx` provides manual Reload/Previous/Next, page-local
  filtering and isolated column preferences, not automatic polling or Live.
  Partial/truncated pages, incomplete cells and unknown identities are visible.
  Unknown identities have no drawer/actions; unknown fallback ages stay unknown.
  No aggregate-cache enrichment, per-object detail fan-out or schema editor was
  added. Neither generic inspection nor printer columns imply complete
  `kubectl describe` equivalence or operator-specific plugins.
- Fixture files exist for inspection, exact Events, per-kind API/UI, navigation
  and identity races; their presence alone does not establish passing results.
  This documentation-only alignment runs `git diff --check`, not tests/builds,
  and does not authorize live reads, `.token` access, commits or Helm changes.

## Workload Live extension — implementation and acceptance

Generic CR inspection/exact-kind browsing is locally committed as `5b1913d`.
Before Helm Recovery, the approved Live extension adds Deployments, StatefulSets,
DaemonSets, ReplicaSets, Jobs, and CronJobs to the bounded Pods foundation.

- [x] Shared typed LIST/WATCH adapters and manager-wide capacity/lifecycle guards.
- [x] Exact context/namespace/kind SSE and cache-only revision endpoints.
- [x] Six mounted tables reuse shared transport, snapshot coverage, Live control,
  causal query refresh and UID-safe selection/drawer handling.
- [x] Focused verification: 67 workload mounted tests and 79 shared transport/query
  tests passed; 5 existing Pods Live cases passed. The final strengthened coverage
  and visibility-resume subset passed (12 cases); typecheck and focused lint passed.
- [x] User Help and engineering read-ownership documentation updated.
- [x] Full repository `make check DOCKER_BUILD=0` passed before the final Go
  invalidation-generation follow-up. The long mounted UI scenario was split
  into independent stories without raising timeouts or dropping assertions.
- [x] Final independent review approved the invalidation-generation fix; gated
  LIST regression reproduced RED then passed GREEN for Pods and all six kinds.
  Focused Live race tests, complete dataplane/server tests and vet passed.
  Pinned UI + Go executable build passed; embedded source restored by hash.
- [x] Authenticated read-only real-server API smoke on `127.0.0.1:10443`:
  all six SSE streams reached live with exact context/namespace/kind/scope;
  revision snapshots covered the notification; missing/unknown context and
  absent authorization were rejected; repeated cache misses returned 503;
  ordinary/manual reads returned 200 after disconnect. No cluster mutations.
  Deployment and ReplicaSet rows had UIDs; the other four lists were empty in
  the selected namespace, so their real row behavior is not established here.
- [x] Headless Chrome against the running server, all six real tables: enable
  Live → `Live=live`, revision request observed, Refresh hidden, disable →
  polling, manual Refresh → HTTP 200. No `/metrics` or `/events` requests were
  observed in these scenarios; CronJob tooltip explicitly excludes Events.
- [x] Browser reconnect verified for all six kinds by forcibly closing SSE
  through a loopback proxy: reconnecting → live; no cluster mutation.
- [ ] Final-binary acceptance. The running server was not restarted with the
  race fix. Real resource replacement and hidden-tab transitions were not
  exercised by this smoke; mounted regressions remain distinct from
  cluster-backed evidence.
- [x] User approved a local checkpoint commit and proceeding to Helm Recovery.
  No push/release or commit of subsequent Helm changes is implied.

CronJob Live streams resource status, not Events or event-derived evidence.
Services, Nodes, CR and Helm Live are excluded. The next implementation stage is
Tranche 5 below, not an automatic expansion of the Live allowlist.

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

### Coherent delivery block

- [x] Fresh exact-context metadata preflight; bounded decoding and validated
  canonical Helm Secret identity; no sensitive payload in recovery responses.
- [x] Guarded single-record deletion for pending-upgrade/pending-rollback only,
  immediately preceding usable history, fail-closed RBAC/read-only, typed
  confirmation, stopped-writer acknowledgement, UID/resourceVersion
  preconditions and post-delete verification.
- [x] Integrated drawer recovery section, Secret navigation, ordinary-action
  semantics, generation-safe reads/mutations and explicit stale-preview retry.
- [x] Backend and mounted UI regression coverage plus Help/read-ownership docs.
- [x] One integrated review and final verification/build boundary; no repeated
  full gates after each edit. No real-cluster recovery deletion during testing.

Live checkpoint `8fb3a9c` is separate; this block remains uncommitted until
reviewed/approved. No push or release is authorized.

Verification: focused Helm Recovery race tests, full `make check DOCKER_BUILD=0`,
and `make build DOCKER_BUILD=0 OUTPUT=.cache/helm-recovery-acceptance/kview
VERSION=helm-recovery-acceptance` completed successfully. The executable reports
`helm-recovery-acceptance`. Independent static review found no production safety
defect; its inconsistent blocked-middle fixture finding was corrected before
the successful final gate. Running server was not replaced; real-cluster recovery
deletion was not exercised. New Helm changes remain uncommitted for acceptance.

### Drawer layout correction after operator review

- Restored the single native tab strip required by ResourceDrawerShell; local
  operator Notes now lives beside the distinct chart-rendered Release Notes.
- Recovery is a native, lazy tab inside the scrollable drawer body, with compact
  actions and collapsed guidance. Full safety wording remains in confirmation.
- Semantic tab identity and retained detail state preserve Recovery during
  post-mutation refresh success/failure; keyboard actions remain distinct.
- Final focused UI/shared-shell/keyboard suite: 51 tests passed; typecheck and
  focused ESLint passed. UI and executable build passed with stable source hashes.
- Real Chromium with explicit fixture API data passed wide/narrow layout checks:
  one tab strip, distinct notes, lazy recovery, compact button, bounded scrolling
  and confirmation guard. Screenshots: `.artifacts/helm-layout/`.
- Built `.cache/helm-layout-acceptance/kview`. Running server unchanged; its token
  returned 401, so no live-cluster acceptance is claimed for this UI follow-up.
