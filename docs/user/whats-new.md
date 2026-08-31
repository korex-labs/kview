# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- Resource drawers now include cache-derived resource maps, making it easier to
  inspect related objects and rollout shape without leaving the current browse
  workflow.
- Resource drawers can now open full-screen, giving dense resource details and
  maps more room during investigation.
- Dataplane signals now detect connectivity interruptions and suppress runtime
  noise more cleanly when the cluster or API is temporarily unreachable.
- Packaged desktop builds now ship with native application icons for a more
  polished installed-app experience.
- Pod drawers can now start native **Pod Debug** sessions for supported Linux
  pods, attaching an ephemeral debug container directly into the Activity Panel
  terminal workflow.
- Job reruns and CronJob manual runs can now open a debug run view with live
  timeline, logs, and events, making one-off batch troubleshooting easier to
  follow from inside kview.
- Keyboard shortcuts are now fully configurable with presets, per-action
  bindings, collision checks, and Help integration that reflects the active
  effective keymap.
- Dataplane signal settings now support exclusion rules, so expected noise can
  be suppressed by resource name, namespace, labels, or annotations without
  muting unrelated signals.
- Dashboard signal labels are now more compact, improving scanability when
  reviewing busy signal sets.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
