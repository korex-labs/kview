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
  ranking, pod/workload failure detectors, and richer failure/search context are
  in place.
- **Adaptive dataplane**: scheduler health, adaptive profiles, namespace sweep
  coverage, and pressure-aware polling/freshness are visible to operators.
- **Local resource notes**: resources have a local **Notes** tab, triage state,
  and list/tab indicators for note presence.
- **Keyboard and focus registry**: app-owned shortcut registration, focus scopes,
  Escape ownership, contextual actions, table controls, and focus retry requests
  go through `KeyboardProvider`; see `docs/KEYBOARD_FOCUS.md`.
- **In-app Help and release hygiene**: bundled user docs, curated What's New,
  Docker-backed verification, and release notes are part of the normal workflow.

## Product Direction

The active direction is an **operator memory and investigation workflow layer**:
kview should help an operator move from signal → focused evidence → local
triage decision → recurring-context recall → exportable incident report, while
staying local-first, read-honest, and safe by default.

The main rule: local operator knowledge belongs in kview's local store/export
model, not in Kubernetes annotations and not in noisy automatic AI-style memory.

## Primary Feature Track

### 1. Investigation Snapshots

Turn the existing **Investigate Signal** output into a durable local artifact.

- Add **Save Investigation** from the investigation dialog.
- Store signal type/severity, primary resource, related resources, current
  context, generated Markdown bundle, operator note, triage state, and creation
  metadata.
- Surface saved investigations from resource drawers, resource Notes, Activity,
  and search results.
- Include investigation snapshots in settings/profile transfer and export/import.
- Keep snapshots local; never write snapshot metadata back to Kubernetes.

This pack is implemented: saved investigations now cover local persistence,
resource drawers/Notes, Search, Activity, and explicit settings transfer.

### 2. Signal Memory And Recurring Incident Detection

Use local signal history to explain when a current signal has been seen before.

- Track local history keyed by context, signal type, resource scope/kind,
  namespace, and name.
- Show lightweight hints such as **Seen 4 times in 7d**, **Previously resolved**,
  **Known noisy**, or **Last note: ...**.
- Connect the latest note or saved investigation snapshot to the current signal.
- Keep the history bounded, exportable, and easy to reset.
- Avoid background cluster reads; update memory from already observed signals.

Current first slice records bounded distinct observation days and surfaces honest
**Seen Nd / 7d** or **Seen Nd / 30d** hints. Linking explicit resolved/known/noisy
states and latest notes from saved investigations remains the next slice.

### 3. Signal Snooze And Suppression Rules

Let operators intentionally reduce known noise while preserving auditability.

- Add local actions such as **Snooze for 1h**, **Snooze for 1d**, **Ignore in
  this namespace**, or **Ignore until changed**.
- Scope rules by signal type, context, namespace, resource identity, severity,
  and optional profile.
- Show suppressed counts and the reason a signal is hidden or downgraded.
- Include suppression rules in settings/profile transfer.
- Default to visible, reversible, local rules; do not silently hide signals.

### 4. Connectivity And Routing Detector Pack

Add a focused detector pack for traffic-path failures, separate from the existing
pod/workload failure pack.

Candidate signals:

- `service_selector_no_pods`: a Service selector matches no cached pods.
- `service_points_to_unready_pods`: matching pods exist but are not ready.
- `ingress_backend_service_missing`: an Ingress backend references a missing
  Service.
- `ingress_backend_port_missing`: backend Service exists but the referenced port
  is absent.
- `endpoint_slice_empty`: EndpointSlice data indicates no usable endpoints.
- Optional later: network-policy isolation hints when cached policy context is
  strong enough to avoid false confidence.

The pack should rely on cached dataplane/list snapshots and clearly mark coverage
or unknowns instead of doing live exploratory scans.

### 5. Impact Path Drawer

Provide compact, operator-friendly dependency traces rather than a graph hairball.

Examples:

- Ingress → Service → Deployment → ReplicaSet → Pod → Secret/ConfigMap/PVC.
- Service → selector → matching pods → readiness/failure reasons.
- Deployment unavailable → pods → image pull, CrashLoop, scheduling, PVC, or
  secret/config references.
- PVC pending → workloads that reference it.

The drawer should show direct evidence, missing/stale links, and the confidence
level for each edge.

### 6. Dataplane Explanation Drawer

Make freshness and coverage explainable at the resource/list/dashboard level.

- Add a **Why stale?** or **Dataplane details** surface showing last observed,
  TTL, source (`live`, `cached`, `persisted`, `derived`), coverage, and
  completeness.
- Explain why data is not fresher: RBAC denial, scheduler budget, namespace sweep
  not reached, error/backoff, profile mode, or active-view prioritization.
- Reuse existing scheduler health and namespace sweep coverage instead of adding
  a separate diagnostics system.

### 7. Search Query Mini-Language

Make enriched search usable for operator filtering without a new query UI.

Examples:

```text
kind:pod ns:prod signal:high
note:watch
stale:true
health:degraded
imagepull
owner:helm
service:no-endpoints
```

- Parse simple `key:value` tokens with a plain-text fallback.
- Show parsed filters as chips in the search input.
- Keep matching backed by cached dataplane/local-store data only.
- Preserve keyboard and mouse selection behavior.

### 8. Investigation Workspaces

Evolve saved views into lightweight local incident workspaces.

- Bundle a saved dashboard/list state, search query, signal filters, focused
  resources, drawer stack, linked notes, investigation snapshots, and dataplane
  profile.
- Make workspaces exportable/importable with the same transfer model as settings
  profiles.
- Keep them explicit and local; do not auto-create a workspace for every signal.

### 9. Runbook And Dynamic Link Integration

Connect existing Resource Macros/Dynamic Links with signals and notes.

- Associate runbook links with signal types and resource kinds.
- Show **Open runbook** on signal rows and investigation snapshots.
- Allow notes/snapshots to attach runbook URLs.
- Prefer template-based local configuration over hardcoded product-specific
  links.

### 10. Exportable Incident Reports

Generate a copyable Markdown report from current investigation state.

Include:

- cluster/context and active profile;
- selected namespaces/filters/search query;
- top signals and affected resources;
- related notes and saved investigation snapshots;
- dataplane freshness/coverage/degradation;
- runbook links;
- suggested next checks and known unknowns.

This should build on saved investigations and impact paths rather than duplicate
investigation logic.

## Architecture And Reliability Packs

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

- investigation snapshot schema and API contracts;
- signal-memory and suppression-rule models;
- impact-path edge/confidence contracts;
- search query filter contract.

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
