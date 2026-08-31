# Roadmap

This document captures the active product and architecture plan for kview. It is
not a release promise; it is the shared planning queue used to keep related work
grouped into controlled, independently verifiable packs.

## Current Position

kview is now past the first round of navigation, profile, search, signal, and
dataplane foundations. The next product phase should not rebuild those features;
it should connect them into durable operator workflows.

Recently completed foundation work:

- **Saved views**: resource-list saved views were added and then unified with
  dashboard signal views, with shared picker controls and settings/profile
  transfer coverage.
- **Profiles**: local operator settings profiles and dashboard/dataplane
  presentation profiles are available from Settings.
- **Guided investigation**: **Investigate Signal** provides a read-only dialog,
  helper runs, related resources/signals, and a copyable Markdown debug bundle.
- **Search and command entry**: header search and commands are unified; cached
  dataplane search results include kind, namespace, health/status, signal count,
  severity, attention state, and match reason context without live cluster scans.
- **Signals**: dashboard filters, local acknowledgements, resource attention
  ranking, pod/workload failure detectors, richer failure/search context, and
  structured per-signal resource exclusion rules with cache-only preview and
  prefilled quick exclusion actions on signal rows are in place.
- **Connectivity diagnostics**: cache-only Service and Ingress routing detectors
  distinguish confirmed failures from unknown Pod, Service, and EndpointSlice
  coverage; the functional tranche is implemented and verified.
- **Signal snooze and runtime suppression**: context-local **Snooze 1 hour**,
  **Snooze 1 day**, **Ignore until changed**, **Show now**, exact suppressed
  summaries, and active-context transfer are implemented and verified as a
  functional tranche.
- **Adaptive dataplane**: scheduler health, adaptive profiles, namespace sweep
  coverage, and pressure-aware polling/freshness are visible to operators.
- **Local resource notes**: resources have a local **Notes** tab, triage state,
  and list/tab indicators for note presence.
- **Configurable keyboard actions**: the typed Action Registry, compiled presets,
  per-action overrides, multi-chord sequences, conflict validation, effective
  Help, contextual drawer actions, and bindable guarded Custom Commands/Actions
  go through `KeyboardProvider`; see `docs/KEYBOARD_FOCUS.md`.
- **In-app Help and release hygiene**: bundled user docs, curated What's New,
  Docker-backed verification, and release notes are part of the normal workflow.
- **Kubernetes-native Pod Debug**: Running Linux Pods can add a baseline,
  non-privileged ephemeral container through backend-owned orchestration, wait
  for runtime status, and attach through the existing terminal Activity surface
  with exact RBAC checks and request-id idempotency.

## Product Direction

The active direction is an **operator memory and investigation workflow layer**:
kview should help an operator move from signal → focused evidence → local
triage decision → recurring-context recall → exportable incident report, while
staying local-first, read-honest, and safe by default.

The main rule: local operator knowledge belongs in kview's local store/export
model, not in Kubernetes annotations and not in noisy automatic AI-style memory.

## Active Release Sequence

kview ships broad, coherent product releases rather than publishing every
packaging or maintenance improvement separately. The current sequence is:

1. **Connectivity And Routing Diagnostics — implemented and verified**: honest
   cache-only Service and Ingress evidence distinguishes real routing failures
   from unknown EndpointSlice, Pod, or Service coverage.
2. **Signal Snooze And Runtime Suppression — implemented and verified**:
   context-local, reversible **Snooze** and **Ignore until changed** decisions
   have visible exact suppressed counts and remain separate from inherited
   exclusion policy and operator profiles.
3. **Resource Map — implemented, awaiting local validation**: the standard
   cache-derived parent/child graph tab is available in real Kubernetes resource
   drawers, with bounded lazy navigation and explicit coverage/confidence.
4. **Dataplane Explanation — next**: explain freshness and coverage from existing
   scheduler/dataplane metadata without exploratory live reads.
5. Continue with the Search Query Mini-Language, Runbook integration,
   Investigation Workspaces, and Exportable Incident Reports in that order,
   adjusting only when real operator feedback changes the priority.

The connectivity implementation contract and status checklist live in
[plans/2026-08-27-connectivity-routing-detectors.md](plans/2026-08-27-connectivity-routing-detectors.md).
The active Resource Map contract and delivery plan live in
[plans/2026-08-28-resource-map.md](plans/2026-08-28-resource-map.md).

## Primary Feature Track

Investigation Snapshots and Signal Memory are complete foundations: snapshots are
available from resource Notes, Search, Activity, and settings transfer; recurrence
uses bounded distinct observation days, links explicit prior decisions, supports
transfer/reset, and never infers resolution from partial data. The active queue
starts with the next operator-workflow layer below.

### 1. Signal Snooze And Runtime Suppression (Implemented)

The functional runtime layer is implemented: backend-owned identity gates
context-local **Snooze 1 hour**, **Snooze 1 day**, and **Ignore until changed**;
**Show now** reverses a decision. Suppressed rows are excluded from all visible
projections while exact totals/by-mode counts and bounded rows remain visible.
History continues during runtime suppression, unlike static exclusion. Dedicated
active-context transfer keeps this state out of profiles and inherited signal
policy. Invalid, expired, unsupported, unavailable, and legacy identity states
fail open.

### 2. Connectivity And Routing Detector Pack

Add a focused cached-data detector pack for traffic-path failures:

- Services with no matching cached Pods, separated from matching Pods with no
  ready endpoints;
- missing Ingress backend Services or named/numeric ports;
- EndpointSlices with no usable endpoints, reported only when their observation
  completed successfully;
- explicit unknown coverage when Pod, Service, or EndpointSlice evidence is not
  sufficient to make a failure claim;
- later, bounded NetworkPolicy isolation hints when coverage supports them.

Every result must expose coverage/unknown state instead of triggering live
exploratory scans. This functional tranche is implemented and verified; see the
linked plan above for implementation status and acceptance criteria.

### 3. Resource Map (Implemented; Awaiting Local Validation)

The standard **Resource Map** tab is implemented for real Kubernetes resource
drawers. It centers the current
resource, shows direct parents above and direct children/dependants below, and lets
operators open present related resources without leaving the drawer workflow.
Build only from persisted dataplane snapshots: owner references, explicit object
references, complete selector evidence, namespace containment, and CRD/type
relationships. Show missing/stale/partial links and confidence per edge; use hard
depth/node/edge caps and avoid a general graph hairball or hidden Kubernetes reads.

### 4. Dataplane Explanation Drawer

Explain resource/list/dashboard freshness through existing metadata: last
observed, TTL, source, coverage, completeness, RBAC denial, scheduler pressure,
sweep state, backoff, and active profile. Reuse current scheduler and coverage
state instead of adding another diagnostics system.

### 5. Search Query Mini-Language

Parse simple cached/local `key:value` filters with plain-text fallback and visible
chips, for example `kind:pod ns:prod signal:high`, `note:watch`, `stale:true`, or
`service:no-endpoints`. Preserve both keyboard and mouse selection behavior.

### 6. Investigation Workspaces

Evolve saved views into explicit, exportable incident workspaces containing list
state, search/signal filters, focused resources, linked notes/snapshots, and a
dataplane profile. Do not auto-create workspaces for every signal.

### 7. Runbook And Dynamic Link Integration

Associate local template-based runbook links with signal types/resource kinds and
surface them from signals, notes, and Investigation Snapshots.

### 8. Exportable Incident Reports

Generate a copyable Markdown report from current investigation state: context,
profile, filters, top signals/resources, local notes/snapshots, dataplane quality,
runbooks, suggested checks, and known unknowns. Build on saved investigations and
impact paths rather than duplicating investigation logic.

## Architecture And Reliability Packs

### Optional In-Cluster Deployment And Multi-User RBAC

kview remains local-first, but a future hosted mode may run one read-side
dataplane per cluster while authenticating users through OIDC and preserving
their individual Kubernetes RBAC. The design options, security invariants,
configuration shape, and staged implementation path are recorded in
[IN_CLUSTER_AUTH_ARCHITECTURE.md](IN_CLUSTER_AUTH_ARCHITECTURE.md).

This pack is deferred. If activated, begin with local-mode-preserving interfaces
and live user-authorized reads; enable shared cached surfaces resource by
resource only after exact authorization contracts and cross-user isolation tests
exist.

### Backend-Owned View And Workflow Contracts

Keep moving reusable product rules into backend-owned descriptors/catalogs where
that helps future web, CLI, and TUI surfaces share behavior.

Completed slices:

- resource/view descriptors own labels, icons, scope, sidebar grouping, list
  access targets, list view filter labels, default sort, quick-filter policy,
  quick-filter identity, and baseline searchable fields;
- descriptors own saved resource view enablement, naming,
  compatibility/drift policy, dashboard signal-view defaults, and signal filter
  category presentation;
- descriptors own static action presentation hints while runtime permissions
  remain with capability checks and `/api/actions`.

Next candidates:

- optional suppression audit metadata beyond the implemented runtime record;
- impact-path edge/confidence contracts;
- search query filter contract;
- incident workspace/report schemas when those tracks become active.

Maintain `docs/API_READ_OWNERSHIP.md` whenever read ownership moves from UI or
direct handlers into dataplane/projection APIs.

### Keyboard And Focus Diagnostics

Keyboard navigation itself is already centralized. Future work should be limited
to diagnostics when there is real pain.

Candidates:

- active scope/debug overlay for development builds;
- conflict reporting for duplicate contextual shortcut bindings;
- unresolved action logging when a shortcut is swallowed by a layer;
- coverage for new modal, terminal-like, or workspace surfaces.

### Adaptive Dataplane Reliability

Adaptive scheduler behavior is implemented; the next reliability work is about
explainability and safe tuning.

- Feed scheduler health and namespace sweep state into the Dataplane Explanation
  Drawer.
- Keep foreground/user-triggered reads prioritized over broad background work.
- Prefer visible policy hints before increasing cluster load.
- Keep derived projections honest with `source`, `coverage`, `completeness`, and
  stale/error state.

## Implementation Cadence

Work in large coherent chunks rather than tiny slices:

1. update or write the feature plan;
2. implement backend/API/local-store contract;
3. implement UI workflow;
4. update user docs and API/dataplane docs;
5. run targeted tests;
6. run full `make check DOCKER_BUILD=0` and `make build DOCKER_BUILD=0`;
7. leave changes uncommitted unless Alex explicitly asks for a commit.

## Architectural Themes

- Keep local-first operation and RBAC honesty intact.
- Prefer cached dataplane and explicit user-triggered reads over surprise live
  scans.
- Store local operator knowledge locally and make it exportable/importable.
- Make signal suppression explicit, reversible, and explainable.
- Prefer compact operator paths over general graph visualizations.
- Keep each pack independently shippable and verified before starting the next.
