# Changelog

Release notes for kview are kept in this file. The format is newest first, with
each release summarizing user-facing changes from the previous tag.

## v5.15.0 - 2026-08-05

- Added native Pod Debug sessions for supported Linux pods, so operators can
  launch an ephemeral debug container from the pod drawer and attach to it in
  the Activity Panel without leaving kview.
- Expanded workload debugging with a guided pod debug dialog and optional
  **Open debug run** flows for Job reruns and CronJob manual runs, bringing
  live timeline, log, and event feedback into the same workflow.
- Added configurable keyboard shortcuts with preset keymaps, searchable action
  bindings, validation for collisions and reserved combinations, and support
  for carrying shortcut preferences through settings transfer and profiles.
- Added per-signal exclusion rules in Dataplane settings, including preview
  support and quick exclusion entry points from signal rows, so expected noise
  can be suppressed without hiding other signal types.
- Tightened dashboard signal presentation by compacting labels and separating
  signal and dataplane views more cleanly, improving scanability while keeping
  the underlying dashboard workflow intact.
- Refined the internal UI and dataplane structure around dashboard, settings,
  pod, and snapshot management paths to reduce maintenance hotspots without
  changing the overall product model.
- Refreshed audited Go, npm, frontend-tooling, Playwright, and GitHub Actions
  dependencies to keep the release and CI stack current.
- Expanded automated coverage across pod debugging, keyboard customization,
  signal exclusions, dashboard behavior, backend HTTP handlers, and related
  help content, while also updating in-app documentation for the new operator
  workflows.

## v5.14.1 - 2026-07-24

- Fixed desktop startup reliability for native webview builds by ensuring the
  application window launches on the main thread, avoiding startup failures on
  platforms that require UI creation from the primary process thread.
- Added targeted startup test coverage around native window launch behavior to
  help catch desktop initialization regressions earlier in release
  verification.
- Documented future in-cluster deployment options in the architecture notes to
  guide upcoming deployment and authentication planning work.

## v5.14.0 - 2026-07-23

- Added saved investigation snapshots so operators can keep local copies of
  signal investigations and reopen them later without rebuilding the same
  context from scratch.
- Surfaced saved snapshots across resource drawers, search, and activity views,
  making saved investigation context easier to find while moving between
  browsing and triage workflows.
- Improved signal continuity by showing recurring observation history and
  linking current signals back to saved decisions, helping operators understand
  whether an issue is repeating and what was decided previously.
- Added transfer and reset support for signal memory, and included saved
  snapshots in settings transfer bundles so investigation state can move more
  cleanly between environments and profiles.
- Fixed investigation reopening and dataplane refresh behavior so saved
  snapshots reopen more reliably and joined refreshes keep previously collected
  metrics intact.
- Updated Kubernetes compatibility and release infrastructure by migrating
  service endpoint handling to `EndpointSlice`, publishing desktop webview
  binaries, adopting native TypeScript 7 typechecking, and refreshing core
  toolchain and dependency maintenance.
- Tightened release verification and project maintenance with CI isolation for
  lint and TypeScript compatibility plus targeted dependency refresh work.

## v5.13.0 - 2026-06-24

- Unified saved views across the dashboard and resource lists so operators can
  move between signal triage and list workflows with one shared saved-view
  collection, consistent picker controls, and inclusion in settings transfer
  bundles and full profile backups.
- Added local resource notes surfaced in drawers, activity tabs, and resource
  lists, making it easier to keep per-resource operational context visible
  while browsing the cluster.
- Expanded dataplane visibility with adaptive scheduler health, namespace sweep
  coverage, and pressure-aware polling and snapshot freshness, helping
  operators understand when background enrichment intentionally slows down
  under load.
- Improved failure triage and search context by surfacing stronger signals for
  image pull failures, CrashLoopBackOff states, unschedulable pods, unavailable
  deployments, and richer cached search matches.
- Added `--version` and `-version` CLI flags so packaged binaries can print the
  resolved build version without starting cluster initialization.
- Fixed dataplane and profile reliability by keeping signal timestamps and
  short-TTL metrics snapshots steadier, aligning namespace signal summaries with
  dashboard detectors, preserving app state in full profile backups, and
  avoiding routine custom-resource warmup churn.
- Refreshed the audited npm lockfile and added targeted dataplane and frontend
  test coverage around adaptive TTLs, scheduler health, namespace sweep
  progress, search, notes, saved views, and settings persistence.

## v5.12.0 - 2026-06-16

- Added saved resource views so operators can return to frequently used list
  setups more quickly, with broader backend-driven view policies keeping quick
  filters, default sorting, labels, and action presentation more consistent
  across resource types.
- Expanded resource drawer workflows with tags and Resource Macros, including
  tag automation support so repeated tagging conventions can be applied more
  efficiently while investigating live resources.
- Added operator and dashboard settings profiles, making it easier to switch
  between different working setups for cluster browsing and signal triage.
- Improved keyboard navigation reliability by introducing explicit focus scopes
  and routing drawer and Help escape handling through the shared keyboard
  system, making layered UI surfaces behave more predictably.
- Added backend resource descriptors and focused resource navigation to tighten
  the handoff between lists, drawers, and signal-driven investigation flows.
- Fixed remembered dashboard signal views and overlapping dataplane list
  polling, reducing view reset surprises and unnecessary background refresh
  contention.
- Refreshed Go and UI dependencies, stabilized targeted frontend and
  custom-resource tests, and continued documentation planning work for keyboard
  focus and the broader product roadmap.

## v5.11.0 - 2026-06-13

- Added policy resource views for NetworkPolicies, ResourceQuotas, and
  LimitRanges, with policy drawers linked into the broader namespace and signal
  investigation workflow.
- Expanded custom resource workflows with a more capable list and drawer
  experience, including cleaner browsing, stronger action parity, and support
  for viewing Helm chart version manifests where available.
- Added guarded YAML patch application for supported resources so live updates
  are reviewed and confirmed more safely before changes are sent to the
  cluster.
- Unified header search and command entry into a single workflow and refined
  global search autocomplete behavior, making navigation and command access
  more consistent.
- Improved drawer signal ranking so important attention states surface more
  clearly, refreshed settings section presentation for a more consistent UI,
  and pulled in maintenance dependency updates to keep the release current.

## v5.10.0 - 2026-05-29

- Added a signal investigation workflow so operators can open **Investigate
  signal** from dashboard, namespace, and resource signal surfaces to review
  targeted Events, YAML, Pod log helpers, related signals, and a copyable
  Markdown debug bundle in one place.
- Added Resource Macros and Dynamic Links, letting teams define reusable links
  from manually scoped values plus resource names, labels, and annotations,
  then open those links directly from supported resource drawers.
- Kept signal action controls on one row across signal tables and attention
  banners, making acknowledgement and investigation actions easier to scan
  during triage.
- Expanded release coverage for the new investigation and macro workflows with
  backend, dataplane, and frontend tests, and added in-app Help content for
  Resource Macros and Dynamic Links.
- Refreshed Go and npm dependencies and tightened backend log stream cleanup to
  keep the release current and the investigation helpers more robust.

## v5.9.0 - 2026-05-18

- Expanded dashboard signal filtering so operators can narrow attention by
  namespace groups, newest detections, and tagged resources directly from the
  main cluster workflow.
- Improved dashboard loading during warmup and context switches, avoiding empty
  or zeroed dashboard states and clearing loading indicators more reliably
  after retries.
- Fixed pod metrics presentation so zero values still render as gauges, keeping
  low-usage workloads readable instead of looking missing.
- Polished signal and tag affordances in the UI by rendering inline hint icons
  more cleanly and preserving namespace tag assignments more reliably.
- Reduced release-build churn for embedded UI assets, refreshed dependencies,
  and added targeted screenshot coverage to strengthen release verification.

## v5.8.0 - 2026-05-12

- Added an in-app Help view with bundled end-user documentation, so guidance
  for navigation, signals, settings, workflows, and safety is available
  directly inside kview.
- Added a guarded CronJob suspend/resume action in workload drawers, with clear
  messaging that Helm or other reconcilers may overwrite the temporary change.
- Improved CronJob attention signals in resource lists by surfacing missing
  recent successes and latest warning events earlier in the browsing flow.
- Refreshed embedded web assets and documentation packaging so shipped builds
  include the new Help experience and current help content.
- Expanded help coverage and release-note support in the docs workflow, with
  verification for Help content, state wiring, and CronJob action behavior.

## v5.7.2 - 2026-05-11

- Fixed resource tag table column resizing so width adjustments persist more
  reliably while browsing tagged resources in the UI.

## v5.7.1 - 2026-05-11

- Fixed dataplane scheduler resource kind formatting so scheduler-related
  resources display with clearer, more consistent names across the interface.

## v5.7.0 - 2026-05-11

- Added resource tags in the UI so teams can identify and scan important
  objects more quickly across views.
- Expanded signal workflows with combined dashboard filters and local signal
  acknowledgements, making it easier to narrow noisy result sets and track work
  in progress without leaving the cluster view.
- Improved settings portability with section-level import and export, and
  unified action controls across the interface for a more consistent workflow.
- Accelerated custom resource browsing by caching custom resources in the
  dataplane and improved navigation to problem resources within namespaces.
- Fixed log streaming to surface websocket errors directly, reducing silent
  failures during live investigation.

## v5.6.0 - 2026-05-07

- Improved settings and key-value presentation to make configuration details and
  resource metadata easier to scan in the UI.
- Added namespace signal filter options on the dashboard for faster isolation of
  workloads that need attention.
- Flagged node-bound persistent volumes and claims in dataplane-backed storage
  views to surface placement constraints more clearly during investigation.
- Refreshed the embedded dashboard assets and upgraded core UI dependencies,
  including React, Material UI, TypeScript, Vite, ESLint, and xterm, for a more
  current and stable frontend stack.
- Strengthened release infrastructure with updated dependency automation plus
  security and CodeQL workflow improvements, including code scanning
  remediation and reduced permission scope noise in CI.

## v5.5.2 - 2026-05-06

- Reduced background polling overhead and added diagnostics capture to improve
  performance visibility while lowering idle refresh noise.
- Loaded pod namespace metrics immediately and lazy-loaded the settings view for
  faster access to key resource data and a lighter UI startup path.
- Fixed release and install reliability by resolving the `go install` version
  flow used for distributed builds.

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
