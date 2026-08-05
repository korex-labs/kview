# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

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
- Native desktop builds now launch their application window on the main
  thread, improving startup reliability on platforms that require UI creation
  from the primary process thread.
- Signal investigations can still be saved as local snapshots and reopened
  later, helping preserve triage context between sessions.
- Saved investigation snapshots now appear in resource drawers, search results,
  and activity views, keeping prior investigation context visible across
  workflows.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
