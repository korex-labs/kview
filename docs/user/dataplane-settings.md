# Dataplane Settings

Dataplane settings control how kview keeps read-side snapshots, projections,
metrics, and signals fresh.

## What This Is For

Use Dataplane settings to balance responsiveness, cluster size, API pressure,
metrics availability, and background enrichment.

## Main Controls

- **Edit scope**: chooses whether changes apply to **Global** dataplane
  settings or only to **This context**.
- **Profile**: applies a preset for dataplane behavior.
- **Snapshot TTLs**: control how long cached resource snapshots remain fresh.
- **Persistence**: optionally keeps local snapshots for faster fallback.
- **Observers**: watch selected resources and refresh snapshots in the
  background.
- **Namespace enrichment**: warms related namespace data for dashboard and list
  summaries.
- **Sweep**: optionally enriches more namespaces while the app is idle.
- **All-context enrichment**: optionally warms limited data across multiple
  contexts.
- **Metrics**: controls usage snapshots from metrics.k8s.io when available and
  allowed.
- **Signals**: controls thresholds and overrides for dataplane-generated
  attention signals.

## Scope, Defaults, And Resets

Dataplane settings are layered:

- **Global** settings are the default behavior for every kube context.
- **This context** stores sparse overrides for the active context only.
  Unchanged fields continue to inherit from **Global**.
- Override markers show which context-level fields differ from global values.
  Reset controls remove those context overrides and return the field or section
  to the inherited global value.
- In **Global** scope, reset controls return signal settings to built-in
  defaults. For profile changes, kview applies profile defaults for dataplane
  behavior while preserving operator-tuned persistence, all-context, metrics,
  and signal settings.

Use context overrides for clusters that need a different profile, lower
concurrency, slower enrichment, different metrics behavior, or different signal
thresholds than the rest of your environments.

## Optional Behavior

Profiles are the safest starting point:

- **Manual**: disables automatic namespace enrichment and background sweep.
- **Focused**: keeps high-value data warm for the active namespace, recent
  namespaces, and favourites.
- **Balanced**: warms more namespace targets and key resource lists.
- **Wide**: broadens background enrichment for larger visibility.
- **Diagnostic**: most aggressive profile for troubleshooting broad cluster
  state and stale signal coverage.

Persistence, sweep, all-context enrichment, metrics, and signal overrides are
optional. Enable them when the workflow needs them; leave them conservative
when working against large or rate-limited clusters.

Namespace enrichment is optional and profile-driven. **Current namespace**,
**Recent**, and **Favourites** decide which namespaces are prioritized.
**Resource snapshots warmed by enrichment** decides which namespaced resource
lists are kept warm for those targets. **Background Namespace Sweep** is a
separate optional idle workflow for namespaces outside the focused set, with
per-cycle, per-hour, and pause controls.

**Transient retries** is a dataplane scheduler retry budget for transient list
failures before kview surfaces the error. It does not retry user-confirmed
mutating actions such as deleting a resource or running a Job.

## Common Workflows

- Start with **Focused** or **Balanced** before tuning individual values.
- Use **Manual** when you want kview to read only as views are opened.
- Use **Diagnostic** temporarily when investigating stale or incomplete signal
  coverage.
- Use **This context** before widening enrichment or concurrency for only one
  large or slow cluster.
- Review list metadata when data appears stale or partial.

## Permission And Data Notes

Dataplane reads still obey Kubernetes RBAC. Limited permissions can produce
partial snapshots, degraded projections, or access-denied views. Metrics appear
only when metrics.k8s.io is installed and RBAC allows the required reads.

## Related Settings

- **Dataplane**
- **Dashboard And Signals**
- **Troubleshooting**
