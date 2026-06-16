# Roadmap

This document captures the active product and architecture plan for kview. It is
not a release promise; it is the shared planning queue used to keep related work
grouped into controlled packs.

## Recently Completed

- **Saved resource views**: resource list views can be saved, restored globally,
  marked as modified when drifted, updated, deleted, and cleared back to normal
  list state.
- **Keyboard and focus registry stabilization**: app-owned shortcut
  registration, focus scopes, Escape ownership, contextual actions, table
  controls, and focus retry requests now go through `KeyboardProvider`; see
  `docs/KEYBOARD_FOCUS.md`.

## Primary Feature Track

### 1. Saved Views Follow-Ups

Keep saved views stable before building more workflows on top of them.

- Add manual verification coverage around selecting, modifying, restoring,
  clearing, and deleting saved views.
- Revisit whether saved views should later include pagination, density, pinned
  columns, or dashboard state.
- Use saved views as the first consumer of shared view-state primitives rather
  than letting each list invent its own persistence rules.

### 2. Profiles

Profiles should become a first-class way to switch operational behavior without
manually changing many settings.

- **User profiles**: named local operator profiles for settings bundles such as
  keyboard preferences, smart filters, resource tags/macros, and saved views.
- **Cluster dashboard profiles**: named dashboard/signal/dataplane presentation
  profiles for different operational modes, for example incident triage,
  capacity review, Helm review, or quiet daily monitoring.
- Profile switching should be explicit and reversible, with import/export
  behavior defined before implementation.

### 3. Guided Investigation Workflows

Turn signals, saved views, search, tags, macros, and resource drawers into a
more deliberate investigation flow.

- Let dashboard signals and namespace insights open focused saved-view-like list
  states.
- Keep investigation state local and reversible until a persistence model is
  designed.
- Prefer backend-provided signal/filter/action hints so investigation workflows
  work consistently across future web, CLI, and TUI surfaces.

### 4. Search And Discovery

Continue improving how operators find resources, relationships, and previously
observed information.

- Extend global search with richer relationship context from dataplane indexes.
- Keep search result navigation consistent with saved views, drawers, and
  resource list state.
- Avoid live cluster-wide scans from search; prefer cached dataplane and explicit
  user-triggered reads.

## Architecture And Reliability Packs

### 1. Keyboard And Focus Registry

Current shortcut and focus behavior is split across components. This should move
toward a central registry that decides which keyboard handlers are active for the
current application state.

Completed stabilization slice:

- Focus scopes, contextual actions, table controls, Escape ownership, and focus
  retry requests are centralized through `KeyboardProvider`.
- Resource drawers, settings, help, table focus restoration, global search, and
  terminal focus now use the provider APIs for app-owned behavior.
- Direct component key handlers remain only for input-local behavior such as
  text-field submit/clear.
- Keyboard/focus best practices are documented in `docs/KEYBOARD_FOCUS.md`.

Future candidates:

- Add active-scope diagnostics in the UI for development builds.
- Add conflict reporting for duplicate contextual shortcut bindings.
- Extend coverage when new modal or terminal-like surfaces are added.

### 2. Kview Memory Bank

Investigate a graph-backed memory bank for operator knowledge, tentatively
called **Memory Palace**.

- Model relationships between contexts, namespaces, resources, Helm releases,
  signals, saved views, notes, commands, and recurring incidents.
- Prefer backend-owned indexing/query APIs so future web, CLI, and TUI surfaces
  can reuse the same memory graph.
- Explore local-first storage and export/import before adding UI-heavy features.
- Keep Kubernetes resources as references; do not write memory metadata back to
  the cluster unless a future mutation feature explicitly requires it.

### 3. Backend-Owned View Logic And Product Split Readiness

Reduce frontend-only business logic so the project can later split cleanly into
`kview-core`, `kview-web`, `kview-cli`, and `kview-tui`.

- Completed first slice: resource/view descriptors now own labels, icons,
  scope, sidebar grouping, list access targets, list view filter labels,
  default sort, quick-filter source policy, quick-filter identity, and baseline
  searchable fields. See `docs/VIEW_DESCRIPTOR_CONTRACT.md`.
- Completed second slice: descriptors now own saved resource view enablement,
  naming, compatibility/drift policy, plus dashboard signal-view defaults and
  signal filter category presentation. Signal definitions remain backend-owned
  in dataplane signal catalog APIs.
- Next candidates: action capability presentation hints and deeper
  investigation/search navigation contracts.
- Keep React responsible for rendering and interaction state, not authoritative
  product rules.
- Maintain `API_READ_OWNERSHIP.md` whenever read ownership moves from UI or
  direct handlers into dataplane/projection APIs.

### 4. Adaptive Dataplane Polling And Scheduler Heuristics

Current limits are intentionally bounded, but some hard caps can cause visible
client-side throttling. Improve this without creating unbounded cluster scans.

- Audit where UI polling, namespace enrichment, observers, and scheduler budgets
  interact.
- Add diagnostics that explain whether throttling comes from client polling,
  scheduler queue pressure, Kubernetes/API throttling, or configured caps.
- Consider adaptive intervals based on activity, cache freshness, queue depth,
  error/backoff state, cluster size, and active view importance.
- Prefer recommendations and visible policy hints before silently increasing
  cluster load.

## Architectural Themes

- Keep local-first operation and RBAC honesty intact.
- Prefer backend-owned contracts for shared behavior that future surfaces need.
- Add abstractions only when they remove repeated product logic or clarify
  ownership boundaries.
- Keep each pack independently shippable and verified before starting the next.
