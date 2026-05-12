# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

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
