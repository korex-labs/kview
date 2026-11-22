# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- **v5.19.0 (2026-11-22):** **Dashboard → History** adds signal trends by
  **Severity**, **Signal types**, **Nodes**, and **Namespaces**, using cached
  Dashboard evidence without extra Kubernetes reads.
- Enable collection and separate signal-identity consent in
  **Settings → Dataplane → History**; both default off. Choose **Global defaults**
  or **This context** and 30- or 90-day retention. Disabling collection preserves
  stored history but stops reads until re-enabled; there is no earlier backfill.
- History charts remember rankings and custom selections and show legend
  statistics. **Top signals 10** includes all severities; **Top Changes 10**
  distinguishes observed changes from first-seen signals. Gaps remain unknown,
  and last-known values carry coverage warnings rather than implying fresh data.
- Pod **Logs** load automatically. Switch between **Current** logs and **History**
  for the last terminated container instance when available, control **Follow**
  separately, and retry failed reads. Line count, **Pretty JSON**, and **Wrap**
  preferences survive reloads.
- Related Pod rows in workload drawers now have a **Logs** button for direct
  inspection of an individual Pod's logs.
- Read-only code/YAML, Pod and runtime logs, and YAML diff previews share saved
  text-size controls. Resizing text does not reconnect Pod logs.
- JSON imports now preview section-by-section changes before **Apply**. Select
  what to import, inspect redacted differences, and review normalization warnings;
  unselected sections stay unchanged.
- Opening the **Namespace** dropdown refreshes available namespaces while keeping
  existing options usable and preserving your current selection and view.
- Resource maps distinguish resource families in both themes. Themed scrollbars,
  consistent tabs, and compact controls make navigation and drawers easier to use
  in limited space.
- Saved investigation snapshots remain available in **Notes** and search, without
  appearing as running work. Obsolete investigation and Service/Ingress drawer
  requests no longer replace newer results.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/master/CHANGELOG.md)
in the repository for the complete release history.
