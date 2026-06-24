# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- Saved views now work across both the dashboard and resource lists, so one
  shared saved view can move you between signal triage and list workflows.
- Local resource notes can now be added and reviewed directly in kview, with
  note state surfaced in drawers, activity tabs, and resource lists.
- The Activity view now shows adaptive scheduler health and namespace sweep
  coverage, making background dataplane behavior easier to understand when the
  cluster is under pressure.
- Dataplane freshness now adapts under load, reducing unnecessary background
  churn while keeping operators informed when polling and enrichment slow down.
- Failure signals now do a better job surfacing image pull problems,
  CrashLoopBackOff states, unschedulable pods, and unavailable deployments.
- Global search results now carry richer status and signal context, making it
  easier to spot why a matching resource needs attention.
- `kview --version` and `kview -version` now print the resolved build version
  without starting the application.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
