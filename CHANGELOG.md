# Changelog

Release notes for kview are kept in this file. The format is newest first, with
each release summarizing user-facing changes from the previous tag.

## v5.5.1 - 2026-05-06

- Fixed release packaging so shipped builds consistently include the latest
  embedded UI assets and committed frontend build output.
- Improved release reliability for installed binaries by aligning the embedded
  interface with the expected application version.

## v5.5.0 - 2026-05-05

- Added all-context background enrichment so dataplane insights can keep filling
  in across contexts while selected-context reads and streams stay pinned to the
  active cluster for safer navigation.
- Expanded keyboard-first workflows with shortcuts, resource-view and workflow
  navigation, and settings to control keyboard preferences directly in the UI.
- Improved cluster browsing with smart namespace sorting, sortable namespace
  favourites, severity-grouped quick filters, collapsible sidebar sections, a
  more consistent drawer/action layout, and persisted activity panel state.
- Added resource and settings icons across navigation and details, refined the
  activity panel, and improved responsive truncation hints for denser screens.
- Strengthened release and quality workflows with read-only real-cluster
  Playwright coverage, keyboard help tests, reused Docker release toolchains,
  installable `go install` releases, and release documentation updates.

## v5.4.0 - 2026-04-29

- Added custom resource browsing with Helm deep-links, giving operators a broader
  path from CRDs and custom resources into related Helm context.
- Refined namespace lists, dataplane chips, cron schedule hints, event panels,
  pod environment value display, drawer actions, YAML folding, and attention
  signal presentation.
- Added versioned dataplane policy bundles, context overrides, bbolt cache
  migrations, and scoped settings for global versus context-specific dataplane
  behavior.
- Made the Docker toolchain the default build path, added GitHub Actions checks,
  coverage artifacts, repository contribution/security templates, Dependabot
  grouping, and a golangci-lint baseline.
- Improved Go, session, stream, port-forward, job-debug, and UI test coverage,
  and fixed lint, transient loading, settings, policy synchronization, and Go
  module path issues for v5 releases.

## v5.3.0 - 2026-04-25

- Added guarded live YAML editing with validation, safeguards, risk analysis, and
  normalized YAML views across more resources.
- Added smart collapsible YAML blocks and deep HPA drawer links for namespaces
  and targets.
- Added signal history freshness tracking with first-seen and last-verified UI.
- Captured final logs for short-lived job debug pods.
- Unified chip styling, aligned gauge colors with the chip theme, stabilized
  frontend tests, and applied safe npm maintenance updates.

## v5.2.0 - 2026-04-23

- Added CronJob and Job run support with optional realtime debug.
- Added user settings for signal thresholds and moved those thresholds into
  dataplane policy.
- Added persisted cache purging once entries are older than the configured TTL.
- Refactored namespace enrichment into dataplane settings.
- Improved backend connection error handling and offline UI behavior.

## v5.1.0 - 2026-04-22

- Refactored the cluster dashboard UI and startup flow, including a loading
  dialog and faster perceived startup.
- Added pod metrics and drawer resizing with persisted settings.
- Introduced signals-first drawers and `AttentionSummary` across Kubernetes
  resource details, with backend-driven list/detail status and signal parity.
- Added per-resource dataplane signal endpoints and promoted pod/deployment
  drawer warnings to backend signals.
- Improved linked-resource visibility, HPA list status, drawer layouts, and
  Helm release history scrolling.

## v5.0.1 - 2026-04-20

- Fixed initial resource loading into the UI during startup.
- Applied minor UI normalization and polish.

## v5.0.0 - 2026-04-19

- Rebranded the project and module references to `korex-labs/kview`.
- Fixed namespace enrichment and persistent cache settings.
- Fixed smart filter resource selection based on resource scope.

## v4.2.0 - 2026-04-19

- Moved HorizontalPodAutoscaler handling into the backplane.
- Unified gauge graph presentation and refined HPA signal display.

## v4.1.0 - 2026-04-18

- Added HorizontalPodAutoscaler resource support and HPA dashboard signals.

## v4.0.0 - 2026-04-17

- Added derived projections and migrated dashboard signal handling to a signal
  store.
- Added optional latest-release checks against GitHub releases.
- Improved terminal sizing, terminal color support, YAML code block layout, and
  dataplane search UX.
- Reorganized Kubernetes resource packages, promoted shared API shape types, and
  extracted dashboard, namespace signal, formatting, polling, and layout helpers.
- Removed legacy/duplicate UI paths and updated documentation.

## v3.6.0 - 2026-04-10

- Added namespace events to the namespace details drawer.
- Added dataplane stats and expanded cluster dashboard pagination, search, and
  attention handling.
- Enriched ingress, service, PVC, cluster-scope, ClusterRole, and
  ClusterRoleBinding detail/list surfaces.
- Improved observers, namespace list enrichment, and dashboard behavior.

## v3.5.0 - 2026-04-09

- Enriched the namespace details drawer for better observability.

## v3.4.0 - 2026-04-09

- Added Helm release rollback.
- Added version information in the sidebar and a project FAQ.
- Improved cluster dashboard UI polish.

## v3.3.0 - 2026-04-08

- Improved cluster dashboard hotspot prioritization, especially for pod restart
  signals and restart-by-day counts.

## v3.2.0 - 2026-04-08

- Added optional persistent dataplane cache storage.
- Added dataplane cache search and fixed cache restore on startup.
- Further improved dataplane search and dashboard behavior.

## v3.1.1 - 2026-04-08

- Added `--config` to override `KUBECONFIG`.
- Moved Kubernetes actions into their own package.
- Added application log and favicon assets.
- Updated documentation for auth dependencies and Windows setup.

## v3.1.0 - 2026-04-08

- Fixed a concurrent map write bug in policy handling.
- Fixed GitHub Actions deprecations, build warnings, and dependency bumps.

## v3.0.1 - 2026-04-08

- Fixed GitHub release workflow issues.

## v3.0.0 - 2026-04-08

- Added the read-side dataplane foundation with scheduler-mediated reads,
  normalization, capability learning, observers, snapshots, projections, and
  runtime-visible refresh activity.
- Backed namespace summaries and the cluster dashboard with shared dataplane
  snapshots, freshness, coverage, and projection metadata.
- Migrated many resources, including service accounts, roles, role bindings,
  Helm releases, and nodes, onto dataplane-backed reads.
- Added persistent cache search, user settings, custom commands, custom actions,
  force delete, connectivity handling, offline mutation protection, and richer
  Activity Panel behavior.
- Added Docker build and GitHub release workflow support.

## v2.2.1 - 2026-03-15

- Updated documentation.

## v2.2.0 - 2026-03-14

- Refactored the React UI structure, resource actions, list/table shell, drawer
  layout styling, and shared style tokens.
- Improved TypeScript type safety and removed unused UI code.
- Improved API token handling by preferring Authorization headers over normal
  query strings.
- Improved backend runtime logging and frontend API error handling.
- Added a minimal quality and safety net without changing product behavior.

## v2.1.1 - 2026-03-14

- Updated and adjusted documentation.

## v2.1.0 - 2026-03-14

- Heavily refactored and polished the UI/UX.
- Improved session handling and Activity Panel behavior.

## v2.0.1 - 2026-03-14

- Added port forwarding and RBAC handling improvements.
- Fixed terminal behavior after RBAC changes.

## v2.0.0 - 2026-03-13

- Added the context-safe capabilities/actions scaffold and hardened API errors.
- Implemented guarded mutations for deployments, Helm releases, workloads,
  networking resources, ConfigMaps, Secrets, and other supported resource kinds.
- Added the frontend mutation framework and common action components.
- Added light/dark theme support, the Activity Panel, runtime logs, session
  foundation, terminal sessions, and optional webview builds.
- Updated README, architecture, planning, and AI collaboration documentation for
  the completed mutation and runtime milestones.

## v1.0.0 - 2026-02-13

- Established the initial local Kubernetes UI with read-only exploration for
  pods, deployments, services, ingresses, ReplicaSets, Jobs, CronJobs, nodes,
  namespaces, ConfigMaps, Secrets, StatefulSets, DaemonSets, PVCs, PVs, RBAC
  resources, Helm releases, CRDs, and resource quotas.
- Added dense tables, quick filters, drawer-based detail views, YAML/events/logs
  surfaces, and shared drawer/list UI primitives.
- Added cross-resource navigation for workload rollouts and Pod/Service/Ingress
  relationships.
- Added kubeconfig loading semantics, multi-context authentication fixes, a
  connection error banner, soft health warnings, namespace overview, and quota
  usage gauges.
- Added the UI/UX guide, roadmap, milestone system, and AI collaboration
  contract.
