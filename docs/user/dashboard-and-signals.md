# Dashboard And Signals

The cluster dashboard is the main triage view. It summarizes visible cluster
state and surfaces attention signals from cached dataplane snapshots.

## What This View Is For

Use the dashboard to answer:

- Which namespaces or resource types need attention?
- Are signals concentrated by severity, kind, namespace, or reason?
- Is cached coverage broad enough to trust the summary?
- Which resource should be inspected next?

## Main Controls

- **Signal chips**: filter the signals table by priority, newest detections,
  severity, acknowledgement state, tags, kind, signal reason, namespace, or
  derived signal source.
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
- acknowledgement state

Signals are heuristics over visible data. They are useful for prioritization,
but should be confirmed from resource details, events, logs, and YAML before
making risky changes. Recurrence hints are local signal memory: they mean kview
observed the same stable signal identity on multiple days. They do not claim that
each day was a separate incident or that an absent signal was resolved.

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
- **Investigate signal**

Some detail signals are created from drawer-only or list-level evidence. When
the backend has not assigned a stored signal history key yet, kview derives a
stable local key so acknowledgement and investigation still appear together.
Acknowledgement remains a triage marker only; it does not change Kubernetes
state and does not mark the resource healthy.

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
