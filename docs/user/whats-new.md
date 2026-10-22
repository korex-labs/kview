# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- **v5.18.0 (2026-10-22):** Helm release maps now follow up to two cached
  ownership hops, connecting manifest workloads to ReplicaSets, Jobs, and Pods.
  **Expand Pods** reveals sample members, and **Show workload history** reveals
  older workloads. Coverage warnings distinguish partial evidence from absence.
- Search now accepts filters such as `kind:pod ns:prod signal:high`, displayed
  as removable chips. Filters use cached resources without scanning Kubernetes.
- Search shows the current namespace first, then other results in the active
  context. Successful results remain available if another page fails, with
  **Retry failed search** for failed pages.
- Supported search results now include a keyboard-accessible **Map** entry to
  open their **Resource Map** directly for faster relationship investigation.
- Resource maps have steadier layouts and expandable groups of observed Pods
  with the same exact owner. Counts reflect cached evidence, not cluster totals;
  a simplified layout preserves navigation if automatic layout fails.
- With Persistence enabled, opening a resource list restores its saved snapshot
  before other saved lists finish loading. Rows stay marked stale until refreshed;
  Dashboard totals and maps may have partial coverage during background loading.
- The interface loads less code upfront, deferring syntax highlighting, search
  drawers, and terminals until needed, with compressed and cached asset delivery.
- A one-time **Optional updates and statistics** invitation offers independent
  choices, both off by default. **Share anonymous installation statistics** sends
  a random installation identifier and version, without cluster or resource
  data. Consent stays in this browser; privacy and retention details are in
  **Settings → Appearance**.
- Optional **Check for kview updates** now uses cached release metadata with a
  GitHub fallback. Update checks do not send installation statistics, and
  development builds no longer show misleading update notices.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/master/CHANGELOG.md)
in the repository for the complete release history.
