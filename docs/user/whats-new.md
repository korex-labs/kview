# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- YAML tab actions now apply generated live patches after validation, diff
  review, risk warnings, and typed confirmation.
- Signal workflows now include **Investigate signal**, which opens a read-only
  evidence dialog with targeted Events, YAML, Pod log helpers, related
  signals, and a copyable Markdown debug bundle for faster triage.
- Resource drawers can now show Dynamic Links built from reusable Resource
  Macros, including manually scoped values and values extracted from resource
  names, labels, and annotations.
- Signal actions now stay on one row across dashboard, namespace, and resource
  signal surfaces, keeping acknowledgement and investigation controls easier to
  scan during triage.
- In-app Help now includes dedicated guidance for configuring Resource Macros
  and Dynamic Links.
- Namespace drawers now keep list signal badges and drawer signal tables
  aligned by adding fallback signals for problematic resources when needed.
- Dashboard signal filters now support namespace groups, newest detections, and
  tagged resources, making it easier to isolate the clusters and workloads that
  need attention.
- Dashboard warmup and context switching are more stable, with fewer empty or
  zero-value states while background retries finish loading signal data.
- Pod metrics now keep zero values visible as gauges, so quiet workloads remain
  readable instead of appearing to have missing data.
- UI hint icons render more cleanly inline and namespace tag assignments are
  preserved more reliably during tagging workflows.
- The new Help view brings bundled end-user documentation into kview, covering
  navigation, signals, settings, workflows, safety, and troubleshooting
  without leaving the app.
- CronJob drawers can temporarily suspend or resume schedules in real time,
  with the Helm or reconciler override caveat shown in the action flow.
- CronJob lists now surface missing recent successes and latest warning events
  earlier, making it easier to spot schedules that need attention.
- Dashboard, namespace summaries, and resource drawers use signals-first
  workflows so users can move from cluster-level attention to the exact
  resource that needs inspection.
- Dashboard signals can now be filtered by newest detections, with a tunable
  newest signal limit for recent signal triage.
- When Resource Tags are enabled, dashboard signal filters can include tag
  chips for tagged resources with matching signals.
- Settings support import/export, smart filters, resource tags, custom
  commands, custom workload actions, and dataplane policy tuning.
- Keyboard navigation includes shortcuts and command mode for faster resource,
  namespace, context, and settings navigation.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
