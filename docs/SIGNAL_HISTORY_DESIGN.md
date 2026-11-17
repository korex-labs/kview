# Signal history architecture

This is the current signal-only History contract. Operator instructions live in
[user help](user/dashboard-and-signals.md#collection-settings). Dashboard → History
contains four charts; Settings → Dataplane → History owns collection consent.
There is no gauge/import mode, resource table or instance Timeline in the UI.

## Ownership and consent

- `internal/dataplane` reads already-published caches and reuses the pure Dashboard
  detector pipeline before recurrence, suppression projection and pagination.
  History must not call Dashboard handlers, create/hydrate planes, resolve clients,
  warm caches, perform Kubernetes reads/writes, or update operator activity.
- `internal/localhistory` owns the cancellable worker, bbolt handle, retention and
  bounded reducers. Enabled exact contexts consume cache publications through a
  bounded coalescing queue; maintenance is separate from publication ingestion.
  Queries never collect, prune, or backfill. Publication-driven does not guarantee
  full transition capture: coalescing, overflow and missing dependencies degrade coverage.
- `internal/server/handlers_history_settings.go` owns durable exact-context policy.
  `enabled` and separate `signalHistory` consent default OFF. Collection consent
  does not grant resource-identity consent. Opening either UI surface or
  changing a browser profile never enables collection or resets consent.
- The server generates `signalEpoch` only on the first valid explicit identity-consent
  save, persists it before starting collection, and preserves it across ordinary
  saves, disable/re-enable and restart. `signalEpoch` is server-owned GET metadata,
  never a POST field. No operator epoch field, implicit rotation or retarget detection exists.
  Use distinct kubeconfig contexts for different clusters.
- History records the full canonical Dashboard signal population after Dashboard
  policy filters, including direct Node and namespace signals. There is no separate
  History cluster switch, namespace selection, or eligibility filter. Dataplane
  enrichment controls upstream cache population, not History admission. History
  reads published caches only; missing evidence is not a healthy zero or proof
  of disappearance.

## Storage and safety

Each `history-real-v1.db` contains only `history-meta-v1` (schema 1 and
30/90-day retention) and `signal-trends-v1` (schema 1 and retained-byte
accounting). New databases initialize both atomically after exclusive creation.
Existing files are validated read-only before writable opening or managed retention
changes. Prototype, foreign, incomplete and unsupported schemas are refused without
migration, repair or deletion; explicitly relocate/remove an incompatible file only
if starting fresh is intended. Current trend payload validation and actual retained
bytes, database bytes and retained-hour diagnostics remain independent of this boundary.

Settings are a bounded private JSON file under
`os.UserConfigDir()/kview/local-history/settings.json`. New directories/files use
0700/0600. Validate then write/sync a private temporary file and atomically rename;
parent-directory fsync and protection against another process with the same OS UID
are not promised. Context DB paths use SHA-256 of the exact context, not raw names.
History is plaintext local operator data, protected by application authentication,
not per-context Kubernetes RBAC.

Settings POST requires explicit Bearer authority, JSON, one known exact context,
no query parameters, a bounded body and the current revision. Read-only mode locks
changes. POST requires `{scope, revision, globalRevision}`, with optional
`enabled`, `signalHistory`, `retentionDays` and context-only `reset`. Policy values
are sparse overrides, not replacement policies. Reset removes overrides before
applying any supplied fields. Retired fields and legacy bodies are rejected.
GET returns global defaults, sparse override, effective policy, server-owned epoch,
collector status, capabilities, editability, and sanitized per-context startup failures.
Global defaults contain no epoch; each consenting registered context gets an
independent durable generation before collection, including newly discovered contexts
on restart. Collection and identity consent default OFF. Browser profile changes
cannot opt in. Global edits reconcile inheritors without replacing explicit overrides. Revision conflicts require reading back current durable
state before retrying. Persist desired state first; cancel/join the old
worker before closing/reopening its DB. Start failure reports saved desired state
and an error (503), not silently rolled-back consent. Incompatible databases return
`history_database_incompatible` with sanitized instructions to stop kview, move the
old database aside only if starting fresh is intended, then restart and save to retry.
GET settings and status preserve that failure classification without exposing raw
storage errors or paths. UI confirms with GET readback.
Changing context/token or leaving the form aborts requests and prevents late results
or follow-up reads from publishing for the old identity. Cancellation cannot undo a
POST already durably accepted by the server.

Disabling joins/closes the worker but does not erase data; data reads require
re-enabling collection and identity consent. Disabled stores are not pruned.
Retention is 30/90 days; shortening prunes during successful publication or
maintenance, increasing cannot recover removed observations. Queries do not prune. bbolt reuses freed pages but does not automatically shrink its
file. The logical 512 MiB guard (496 MiB ingestion threshold) is not a filesystem
quota, free-space guarantee or aggregate disk budget.

Use Settings → Dataplane → History for exact-context collection consent. There
is no startup JSON override or separate gauge API.

## Trends API and interpretation

`GET /api/history/signal-trends` is authenticated and background-classified, requires
exactly one nonempty `X-Kview-Context`, collection plus identity consent, and no body.
It reads retained history and, only when requested, process-local diagnostics;
never samples or refreshes caches. `from`/`to` are UTC hour boundaries, `[from,to)`, up to
90 days. Invalid/duplicate/unknown query fields are rejected.

- Rules: `topHigh10`, `topChanges10`, `custom`.
- Nodes: `topHigh10`, `topChanges10`, `custom`.
- Namespaces: `topHigh10`, `topChanges10`, `favourites`, `recent`, `custom`, `tag`.
- Explicit `rule`, `node`, `namespace` lists have at most 20 keys each. Empty custom
  selection selects nothing. Node keys are JSON `[name,uid]`; names are not identity.
  Favourites/recent/tags resolve to current UI namespace lists, not historical tags.

Schema version 1 returns exact context/window and query cutoff `asOf`, `severity`, `rules`, `nodes`,
`namespaces`, bounded `catalog`, and `diagnostics`. Series carry key/label, fixed-window
ranking scores and hourly points (`at`, nullable counts, sample/source timestamps,
reason, coverage, `carriedForward`, `freshness`, nullable `sourceAgeSeconds`, and
independent `confirmedChanges`). Counts contain high/medium/low/changes. Null is unknown, observed
zero is distinct, partial is an observed subtotal rather than a cluster total.
Active-count `coverage` and transition `changesCoverage` are independent: confirmed
changes are subtotals, not proof that every transition was observed. Missing retained
coverage remains unknown; coarse buckets degrade each coverage independently.
Retained predecessors can carry active counts into later hours, including across
the start of a query window, but never before their first evidence or after `asOf`.
Original sample/source timestamps are preserved; carried values are not new samples.
Carried hours add no transitions. A positive `confirmedChanges` subtotal remains
visible even with null active counts; unknown zero changes remain a gap. Coarse
buckets retain the last usable active evidence, worst freshness/coverage and maximum
source age, rather than inventing observations at bucket timestamps.
Go zero timestamps mean unavailable; nullable diagnostic rule lists normalize to
empty lists. Replay identity uses bounded per-dependency publication generations,
not ordering of the minimum source timestamp; policy changes establish a new baseline.

Rankings are fixed for the range, descending score then ascending exact key.
Top High sums displayed hourly active High values, including retained carry; Top Changes sums confirmed individual
appearances, disappearances and severity changes, each once. A replacement can
contribute two despite unchanged totals. First observations are baselines. Fresh,
complete, comparable evidence is required for a disappearance. Gaps, policy changes,
selection changes, retention expiry and node moves are not operational transitions.
Node counts union direct and observed hosted contributions; they do not imply
causality or recompute old membership from current Pod placement. Static signal
policy applies; runtime suppression does not resolve a health condition.

The common Dashboard projection supports **30 of 40 catalog rules**: the 29
registry types plus direct Node resource pressure. **10 catalog rules are not in
this projection**: six workload-template reference rules, `pv_node_bound_storage`,
`pod_missing_secret_reference`, `pod_succeeded_with_issues`, and
`pod_young_frequent_restarts`. The noncatalog `resource_needs_attention_fallback`
is also outside this projection. This is not full catalog coverage;
expanding detail rules is deferred.
These exclusions describe projection capabilities, not cluster failures. No detail
fetching is enabled to fill these gaps. Fresh, complete dependency and identity
evidence remains necessary to confirm transitions; stale cached rows still
contribute to active Dashboard counts and retain their source timestamps.

Dashboard and History consume the same pure projection before presentation limits,
with the same static policy, runtime suppression filters and raw row multiplicity.
Capture retains immutable snapshot values consistently within each store; it is
**not an atomic capture across stores**. Equality means both consumers use the
same captured generation, evaluation time and policy, not that independent live
API calls at different times must agree. Current evidence establishes a baseline;
it does not backfill observations before collection. Cache snapshots are not
mutated, and missing/derived/stale evidence cannot prove disappearance.

Boundaries include 1024 scopes, 32768 domains, 20000 compact signals, 4096 groups,
8 MiB current evidence, 2 MiB per hour and 64 MiB retained trend payload per DB.
Queries have a conservative 32 MiB decoded-memory budget and can reject large ranges
with HTTP 422, code `history_query_limit`, and instructions to shorten the period.
This is not a storage outage (503). The HTTP request context reaches the collector
and store scans/projections through cancellable wrappers; existing context-free Go
call sites remain valid. Cancellation is cooperative between bounded operations,
not interruption inside bbolt transaction acquisition, JSON decoding or sorting.
These limits are safeguards, not a large-cluster capacity guarantee. Scope/admission
loss is reported; increasing limits is not a substitute for coverage correctness.

### Internal transition diagnostics

After rebuilding, append `&diagnostics=transitions` to an authenticated trends
request with the same exact-context header and required hour-aligned window, e.g.:

```http
GET /api/history/signal-trends?from=2026-11-16T00:00:00Z&to=2026-11-17T00:00:00Z&diagnostics=transitions
X-Kview-Context: synthetic-context
Authorization: Bearer <existing application token>
```

Replace the synthetic context and window; no new consent, live-cluster request or
settings change is implied. The optional `transitionDiagnostics` object contains
`context`, `epoch`, `acceptedAt`, fixed-vocabulary `reasons` counters, queue
`coalesced`/`overflow`, ring `evicted`, and `recent` rejected-candidate records.
The field is omitted from ordinary responses; active totals and confirmed-change
semantics are unchanged. Invalid, empty or repeated diagnostics selectors fail.

Records describe actual rejected appearance/severity/disappearance or membership
candidates, with `decision: "not-confirmed"`, rule/namespace, old/new domain active
counts, source/evaluation timestamps, source status, identity confidence, optional
resource UID/node/severity, and policy/generation-change flags. Counts and `present`
describe the compared population, **not confirmed resolution**. A missing domain
has unknown transition evidence; unrelated unknown sources are not rejection causes
for a healthy candidate. Queue loss describes coverage, not an invented per-resource
cause. Zero source timestamps mean unavailable, not the evaluation time.

This is future-only, process-local evidence since successful ingestion under the
current store/context epoch, not a historical event log or a reconstruction of past
missing changes. It is not filtered by the requested chart window or selectors.
Restart, store/collector close and accepted epoch replacement reset it. Recent
records are bounded by both 128 entries and 256 KiB encoded JSON per context;
context cardinality follows the existing store scope cap. Counters survive ring
eviction until reset. Resource objects, signal messages, errors, labels/annotations,
policy hashes and signal fingerprints are excluded. Context, namespace, UID and
node identity remain operator-sensitive metadata behind existing authentication
and exact-context identity consent. Reads only copy bounded in-memory evidence;
they do not sample, refresh, create planes or backfill, and use request cancellation.

## UI and cached choices

`SignalHistoryPanel` displays Severity (High/Medium/Low together), Signal types,
Nodes and Namespaces. Shared period/detail controls and compact per-chart rankings
select data; MUI X Charts owns rendering, tooltips and keyboard interaction.
The chart has explicit line, stacked-area and stacked-bar variants sharing axes,
formatting and native MUI interactions. Severity stacks High/Medium/Low in stable
risk colors; the upper boundary is their total or known subtotal, never a claim
of complete coverage. Missing severity layers gap the whole stack rather than
contributing a fabricated zero. Coverage diamonds and carried marks use cumulative
coordinates. Top High and Custom remain line charts. Top Changes stacks confirmed
transitions per interval, admits only positive-evidence series without padding,
and omits zero/null tooltip rows. Empty changes charts say “No recorded changes”,
not “no activity”. Coarser intervals retain last active counts and sum confirmed
transitions while preserving unknown/partial metadata. Axis tooltips show one UTC
timestamp, human labels and formatted counts without repeated coverage text.
Missing line/area evidence reads “No data”, not zero. Source timestamps, reason
codes and collection/storage diagnostics remain below the charts. No CPU/memory
series or raw resource-identity table is mounted.

Signal labels come from the existing context-bound `/api/dataplane/signals/catalog`
endpoint, separately from history data. Responses are cancelled/guarded across
context/token changes; label refreshes never change trend query identity or saved
rule keys. Unknown types get readable fallback names. Full catalog names apply to
legends, tooltips, Custom options and selected chips.

`GET /api/history/inventory` independently peeks published Node/Namespace caches,
without collection consent or live resource reads. Authoritative node name+UID pairs
and namespace names are bounded to 4096 choices per group; derived nodes are excluded.
The period catalog is gathered before top-ten selection. Merge retained/current
choices by exact identity; selected values survive missing inventory, overflow is
visible, and over-20 resolved lists block rather than silently truncate queries.
Namespace metadata absent from the current cache cannot satisfy label/annotation tags.

Visible trends refresh 60 seconds after completion, without overlapping requests.
Document hiding aborts/pauses; returning resumes once. Leaving History unmounts work;
context/token changes key state and abort old inventory/trend/settings requests.
The Settings History tab reuses the Dataplane Global defaults / This context selector
but persists only server-owned History settings, independently of browser profiles.
Debounced serialized autosave sends only edited fields with both revisions. Pending
latest intent survives in-flight requests and conflicts; a newer reset supersedes
obsolete failed fields. Explicit retry rereads authoritative state; context, token
and scope changes cancel obsolete requests. A no-op toggle back reports Saved without
POST. Global startup failures surface the failed inheritor and recovery action even
when the selected collector runs and defaults were saved durably.

## Canonical publication lifecycle

`/api/history/status` exposes exact-context collector status. The collector uses
one publication-driven signal path: explicit collection and identity consent bind
the exact context's bounded publication queue. The worker evaluates the canonical
Dashboard projection and writes retained trends; maintenance handles retention
without manufacturing observations. Reads never drive ingestion.

There is no polling evaluator fallback, gauge collector or instance reducer in
this contract. Policy and storage remain server-owned; changing browser chart
preferences cannot enable collection, rotate identity or mutate retained evidence.
Measure this canonical path before changing retention/cardinality caps,
query-memory limits or writer backpressure.

## Focused verification

Use the pinned Makefile image `kview-build:go1.26.10-node22.23.1`, offline, 2 CPUs /
4 GiB. Run sequentially, one Vitest worker; never compete with a backend gate.
From the repository root, a focused UI command is:

```sh
docker run --rm --network=none --cpus=2 --memory=4g \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace/ui kview-build:go1.26.10-node22.23.1 \
  sh -ec 'npm run typecheck; npm run lint; npm run test:full -- src/components/settings/HistorySettings.test.tsx src/components/settings/SettingsView.test.tsx src/components/resources/dashboard/HistoryMaintenance.test.tsx src/components/resources/dashboard/SignalHistoryPanel.test.tsx src/components/resources/dashboard/historyPresentation.test.ts'
```

Target backend selections to settings/follow/identity, inventory, trends, collector,
publication and storage/reducer regressions, including affected race tests. Use
`GOMAXPROCS=2 GOFLAGS=-p=2` and `go test -parallel=2`; mount repository Go caches.
Consult AGENTS.md for the bounded basic gate; full suites, coverage, browser runs,
build/restart and live consent changes are separate approval boundaries.
