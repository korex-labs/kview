# Dashboard And Signals

The cluster dashboard is the main triage view. It summarizes visible cluster
state and surfaces attention signals from cached dataplane snapshots.

## What This View Is For

Use the dashboard to answer:

- Which namespaces or resource types need attention?
- Are signals concentrated by severity, kind, namespace, or reason?
- Is cached coverage broad enough to trust the summary?
- Which resource should be inspected next?

## Dashboard Sections

The dashboard separates two operator workflows into tabs backed by independent
cached projections:

- **Signals** is the default triage section. It contains attention counters,
  signal filters and search, saved dashboard views, the signal table, and
  investigation actions. Its request does not transfer dataplane runtime
  statistics or resource-usage panels.
- **Dataplane** contains known resource totals, cluster usage, scope and
  freshness, coverage, cache traffic, and scheduler execution statistics. Its
  request does not transfer signal rows or derived signal projections.

kview remembers the last selected dashboard tab locally. On first opening a tab,
kview loads only that tab's endpoint. Returning to a recently loaded tab reuses
its short-lived local cache; background refresh applies only to the active tab.
A load failure is shown inside that tab with a **Retry** action and does not
remove the other tab's cached projection. Switching tabs does not reset signal
filters, sorting, search, or pagination.
Dashboard saved views remain part of **Signals** because they store signal-view
state rather than dataplane statistics. Applying one opens Signals before its
request is issued.

## Main Controls

- **Signal chips**: filter the signals table by priority, newest detections,
  severity, acknowledgement state, tags, kind, signal, namespace, or
  derived signal source.
  Common Kubernetes kinds use their established compact names in the dashboard,
  such as **HPA**, **PVC**, **PV**, and **SA**; filtering and navigation still use
  the canonical Kubernetes kind internally.
- **Signal search**: narrows visible signals by text.
- **Signal sorting**: changes signal order by priority, severity, resource, or
  seen timestamps.
- **Saved view**: save and reapply the current dashboard signal chips, search
  text, sort order, and rows per page from the dashboard header. Dashboard
  saved views live in the same saved-view collection as resource list views, so
  the selector can jump from the dashboard to a saved resource list and resource
  list selectors can jump back to saved dashboard signal views. Applying a
  dashboard saved view resets the signal table to the first page.
- **Signal acknowledgement**: marks a signal as known without treating it as
  resolved. kview shows this action beside signal severity in the dashboard,
  namespace signal tables, and resource drawer attention banners when signal
  actions are available.
- **Runtime suppression**: on backend-identified signal rows, choose **Snooze 1
  hour**, **Snooze 1 day**, or **Ignore until changed**, optionally adding a
  comment. On a suppressed row, choose **Show now** to remove that decision.
- **Investigate signal**: opens a read-only investigation dialog for the
  selected signal. The dialog groups the selected signal, primary resource,
  related cached signals, related resources, and a copyable Markdown debug
  bundle for manual analysis. kview shows this action next to acknowledgement
  so the same signal can be either parked as known or investigated further.
- **Inspect actions**: open the relevant resource drawer or navigate to a
  related list when kview can map the signal to a target.
- **Open focused resource list**: jumps from a signal to the matching resource
  list and applies the signal's resource name as a one-time table filter.

## Optional Behavior

By default, selecting a signal chip replaces the active filter.

When **Combined dashboard signal filters** is enabled, non-derived signal chips
can be selected together. kview sends the selected filters as one combined
signal query and narrows the remaining chip choices to the matching signal set.

The **Top priority** chip follows the dashboard signal limit. The **Newest**
chip follows the newest signal limit and shows the most recently detected
signals first unless another signal sort is selected.

When **Dashboard favourite namespace filters** is enabled, the dashboard
includes signal chips for namespaces marked as favourites in the active context.

When **Dashboard recent namespace filters** is enabled, the dashboard includes
signal chips for recently visited namespaces in the active context.

When **Resource Tags** are enabled, the dashboard can include tag chips for
tagged resources that have signals in the loaded signal set. Tag filtering is
local to kview settings and never writes tags to Kubernetes resources.

Dashboard refresh cadence is configured under **Dataplane**. Wide and
diagnostic dataplane profiles apply a minimum refresh floor so broad dashboard
refreshes do not run too aggressively.

Dashboard saved views live directly in the dashboard header. They are for fast
switching between views such as high-severity production signals, a namespace,
a tag, or newest Helm-related signals. Use the save action to create or update
a dashboard saved view in a dialog, the clear action to leave the selected saved
view and reset dashboard signal controls, and the delete action to remove the
selected dashboard saved view after confirmation. Broader dashboard policy, such as combined filter
behavior, favourite and recent namespace chips, refresh cadence, and signal
limits, remains normal Settings/Profile behavior.

## Signals

Signals are backend-produced and designed for triage. A signal can include:

- severity
- resource kind and resource identity
- namespace or scope
- likely cause
- suggested action
- calculated details
- first seen and last seen timestamps
- local recurrence hints such as **Seen 4d / 7d**, based on distinct UTC
  observation days rather than refresh counts
- explicit saved context such as **Previously resolved**, **Known**,
  **Watching**, or **Known noisy** when an Investigation Snapshot matches the
  signal and primary resource
- acknowledgement state

Signals are heuristics over visible data. They are useful for prioritization,
but should be confirmed from resource details, events, logs, and YAML before
making risky changes. Recurrence hints are local signal memory: they mean kview
observed the same stable signal identity on multiple days. They do not claim that
each day was a separate incident or that an absent signal was resolved. Hover a
saved-context state to review the snapshot title and latest operator note. Select
the state to open the snapshot's primary resource.

Connectivity signals keep missing evidence separate from confirmed routing
failures. A Service selector mismatch requires complete cached Pod label
coverage. A no-ready-endpoints signal requires a successful EndpointSlice
observation. Ingress backend checks require complete cached Service coverage and
distinguish a missing Service, a missing named or numeric Service port, and a
backend with no ready endpoints. **Actual data** shows the selector or Ingress
route and backend identity; **Calculated data** shows the cache coverage and
matching/endpoint result used for the diagnosis.

Per-signal exclusion rules in **Settings → Dataplane → Signals** can suppress
known noisy resources by name, namespace, label, or annotation. Suppression is
performed by the backend before dashboard counts, namespace/resource health,
drawer projections, and signal-history updates. It does not delete prior
history, acknowledgements, Signal Memory, or saved Investigation Snapshots.

Use **Exclude this signal** on a dashboard signal, namespace signal, or resource
drawer attention row to open the same rules editor with an exact anchored
namespace-and-resource-name rule already filled in for that signal type. The
safe default is the current kube context; the dialog can switch to the global
default before previewing and saving. Context-specific replacements still take
precedence over that global policy.
Preview always reports cached candidates from the currently active context,
including when the rule is being saved as the global default.

## Snooze And Ignore Until Changed

Runtime suppression is for a current, reversible triage decision. It is local to
the active kube context, is never inherited, and is separate from signal
acknowledgements, static exclusions, profiles, and global/context signal
settings.

- **Snooze 1 hour** and **Snooze 1 day** use fixed elapsed durations from the
  server timestamp. The row shows the exact expiry boundary.
- **Ignore until changed** hides the current state only. It wakes automatically
  when the backend state fingerprint changes.
- **Show now** removes the active decision immediately.
- The optional comment travels with the suppression and is visible in the
  suppressed-signals section.

These controls appear only when the row has a backend-provided signal history
key. **Ignore until changed** additionally requires a valid backend state
fingerprint. Legacy or detail-only signals that have only a locally synthesized
key fail open: they stay visible and do not show suppression controls.

Suppressed signals are removed from visible counters, filters, lists, and
pagination, but the dashboard shows them separately with an exact total and
**Snoozed**/**Until changed** split plus a bounded row sample. Namespace and
resource signal views also show their suppressed count and bounded rows. Signal
history and recurrence continue while a signal is runtime-suppressed. This
differs from a static exclusion, which runs before history and does not record
excluded observations.

Malformed, unsupported, expired, unavailable, or cancelled suppression state
fails open, so kview shows the signal rather than silently losing it. The v1
state fingerprint uses backend-normalized effective severity, canonical resource
identity, and structured evidence. Text normalization only collapses whitespace;
other wording changes wake the signal. A reused resource name with the same
evidence may still look unchanged, and legacy signals have no fingerprint.

To move or back up these decisions, use the independent **Signal suppressions**
section under **Settings → Import / Export**. Review imported active records in
the suppressed-signals section and use **Show now** for decisions that should not
remain active. See [Import / Export](import-export.md#signal-suppression-transfer)
and [Settings](settings.md#runtime-signal-suppressions).

Opening a focused resource list from a dashboard or namespace signal is
transient navigation. It changes the active list, namespace, and text filter,
and clears stale quick-filter chips, but it does not select or modify a saved
view. Use saved views when you want to preserve the resulting list layout.

## Signal Investigation

Use **Investigate signal** when you want more context before deciding what
changed or what to check next.

The investigation dialog is read-only. It uses cached dataplane signal evidence
to show:

- the selected signal and its current advisory text
- the primary resource the signal points to
- a short diagnosis, most relevant evidence, next steps, and unknowns
- read-only helper findings from targeted Events, supported YAML checks, and
  Pod log snippets when they produce useful evidence
- other cached signals on the same resource as strong evidence
- namespace or same-type matches as weak context, not direct relations
- a Markdown debug bundle that can be copied into notes or an external LLM

The first investigation helpers can read object-scoped Events, fetch supported
resource YAML, check selector/template consistency, verify referenced Secrets,
ConfigMaps, PVCs, and service accounts, and inspect a small current/previous
Pod log tail for common failure patterns. Helpers that do not find useful
evidence stay quiet so the dialog focuses on findings instead of empty checks.
They do not run hidden repairs and do not mutate the cluster. For full logs,
complete event history, and full YAML, use the resource drawer tabs after
reviewing the bundle's targeted checks.

## Signal Actions In Drawers

Resource drawer attention banners use the same action order as dashboard
signals:

- severity chip
- signal reason and calculated detail
- **Acknowledge signal**
- **Snooze or ignore signal** when backend identity is available
- **Investigate signal**
- **Exclude this signal**

Some detail signals are created from drawer-only or list-level evidence. When
the backend has not assigned a stored signal history key yet, kview derives a
stable local key so acknowledgement and investigation still appear together.
That synthesized key does not enable runtime suppression. Acknowledgement remains
a triage marker only; neither acknowledgement nor suppression changes Kubernetes
state or marks the resource healthy.

## Signal Customization

Signal customization lives in **Settings** under **Dataplane** >
**Signals**. The signal catalog lets you:

- filter signal definitions by text
- enable or disable individual signal types
- change effective severity
- change display priority
- tune detector thresholds for supported signals
- reset an individual signal, all context signal overrides, or global signal
  defaults

The signal catalog follows the Dataplane edit scope. In **Global** scope,
changes become the default for every context. In **This context** scope,
changes are stored only for the active context and inherit unchanged values
from global settings.

Detector thresholds are available only for signal types that expose them. The
current threshold controls include restart count, container near-limit percent,
node resource pressure percent, ResourceQuota warning and critical percent,
long-running Job duration, CronJob no-recent-success duration, stale Helm
release duration, unused resource age, young Pod restart window, and Deployment
unavailable duration.

## Permission And Data Notes

The dashboard uses cached namespace list snapshots and other dataplane data.
If visibility is partial, totals and signals reflect the visible scope rather
than the entire cluster. Dashboard panels and list metadata expose coverage and
degradation details where available.

## Related Settings

- **Combined dashboard signal filters**
- **Dashboard favourite namespace filters**
- **Dashboard recent namespace filters**
- **Dashboard signal limit**
- **Newest signal limit**
- **Dataplane**
- **Resource Tags**
- **Signal thresholds**
- [Import / Export](import-export.md#signal-suppression-transfer)
- [Dataplane architecture](../DATAPLANE.md#runtime-signal-suppression)
- [API read ownership](../API_READ_OWNERSHIP.md#4-local-operator-knowledge-reads)
