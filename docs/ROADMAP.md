# Roadmap

This document captures the active product and architecture plan for kview. It is
not a release promise; it is the shared planning queue used to keep related work
grouped into controlled packs.

## Recently Completed

- **Saved resource views**: resource list views can be saved, restored globally,
  marked as modified when drifted, updated, deleted, and cleared back to normal
  list state.

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

- Define focus scopes: app shell, list, drawer, dialog, settings, terminal, and
  embedded Monaco/code views.
- Add priority rules so modal surfaces and text inputs suppress list/global
  shortcuts predictably.
- Centralize shortcut registration, help metadata, conflict detection, and active
  scope debugging.
- Make focus restoration explicit, not component-local best effort.
- Audit all `keydown`/focus listeners and route app-owned shortcuts and Escape
  behavior through `KeyboardProvider`; keep direct window listeners only for
  low-level integration cases with documented justification.
- Document keyboard/focus best practices for new surfaces: scope registration,
  Escape ownership, editable-field suppression, contextual action registration,
  and focus restoration.
- Add regression tests for dialogs, drawers, settings, help, global search,
  terminals, and nested overlays so shortcut ownership remains stable.

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

- Move resource/view descriptors, filter semantics, quick-filter definitions,
  saved-view compatibility rules, dashboard signal definitions, and action
  capability presentation hints toward backend-provided contracts.
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
