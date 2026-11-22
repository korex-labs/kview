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

The dashboard separates live operator workflows into tabs backed by independent
cached projections, with a separate opt-in local-history view:

- **Signals** is the default triage section. It contains attention counters,
  signal filters and search, saved dashboard views, the signal table, and
  investigation actions. Its request does not transfer dataplane runtime
  statistics or resource-usage panels.
- **Dataplane** contains known resource totals, cluster usage, scope and
  freshness, coverage, cache traffic, and scheduler execution statistics. Its
  request does not transfer signal rows or derived signal projections.
- **History** shows opt-in local cached history for the active context, with
  four trend charts. It shares the **Cluster dashboard** header with Signals
  and Dataplane.

kview remembers the last selected dashboard tab locally. On first opening a live tab,
kview loads only that tab's endpoint. Returning to a recently loaded tab reuses
its short-lived local cache; background refresh applies only to the active tab.
A load failure is shown inside that tab with a **Retry** action and does not
remove the other tab's cached projection. Switching tabs does not reset signal
filters, sorting, search, or pagination.

The **Dataplane** tab includes a compact **Explain** action. Its first opening
reuses the visibility and coverage facts already loaded by the tab, then lazily
adds exact-context runtime evidence for profile, observers, scheduler pressure,
and namespace sweep state. It does not reload the dashboard projection. Dashboard
visibility and aggregate coverage retain their own vocabulary: cached row
projections, resource-total scope, list-only namespaces, and current enrichment
session evidence are not flattened into resource-list freshness semantics.
Dashboard saved views remain part of **Signals** because they store signal-view
state rather than dataplane statistics. Applying one opens Signals before its
request is issued.

## History

**Dashboard → History** shows four simultaneous signal-trend charts for the active
context: **Severity**, **Signal types**, **Nodes**, and **Namespaces**. It does
not provide CPU or memory monitoring, instance tables, or instance timelines.
Each chart’s local filters sit to the right of its title. Custom and tag selectors
sit beside the ranking dropdown when space permits; controls wrap on narrow cards.
**Period** and **Detail** remain shared controls above the charts.
Changing a chart’s ranking or selection keeps the other charts visible and shows
loading or retry feedback only on the affected chart. New shared observations may
still update their values without clearing them. **Period** reloads the shared
view immediately; **Detail** only changes local display aggregation.

Your selections survive leaving History and returning, including browser reloads.
**Period** and **Detail** are shared across contexts; chart rankings, custom
selections (including an intentionally empty **Custom** selection), and namespace
tags are remembered separately for each context. Saved Node selections retain
their exact UID rather than selecting a replacement with the same name. Search
text is temporary. These preferences are included in settings/full-profile backups
and saved operator profiles; they do not enable history collection or consent.

### Signal trends

- **Period** selects 24 hours, 7 days, 30 days or 90 days, including the current
  incomplete UTC hour. **Detail** selects hourly, six-hour or daily intervals.
  Severity stacks active High, Medium and Low as areas: the upper boundary shows
  their total, or the known subtotal when coverage is incomplete. Risk colors
  and stack order stay High, Medium, Low.
- **Top signals 10** ranks the sum of hourly active totals over the whole period
  and plots active signals across High, Medium and Low. Only Severity splits
  counts by severity; Custom, Favourites, Recent and Tag also plot all-severity totals.
  Nodes offer **Top signals 10**, **Top Changes 10**, and **Custom**, and default to
  **Top signals 10**, like Signal types and Namespaces. An explicitly saved
  **Top Changes 10** or **Custom** choice is preserved.
  **Top Changes 10** ranks up to ten series by the sum of two counts. **Changes**
  compares usable snapshots, including a baseline restored after restart. Each
  appearance, disappearance or severity difference counts once; replacing one
  signal with another counts twice even if the active total stays the same.
  **First seen** counts signals present at the first usable observation when
  there is no snapshot to compare. For example, finding five signals on that
  first observation adds five first seen, not five changes.
  Bars show the interval when kview observed the signals, not when they began.
  The tooltip breaks out first-seen counts where recorded; older hours keep
  their recorded changes. Only positive scores appear. Policy, membership and coverage
  changes are not incidents. A gap does not prove resolution, and an empty ranking
  does not prove there was no activity.
- **Custom** combines retained series from the selected period with current cached
  inventory. Checked choices come first; search and selected identities survive
  refreshes. Signal types use full names from the existing signal catalog in
  legends, tooltips and choices, with readable fallback names for unavailable
  types; selections retain their original identities. Node choices retain name and UID: a retained node and its replacement
  remain distinct even when their names match. Cached choices can be available
  before history has any samples; selecting one does not create observations.
  Choices are bounded to 4096 per group, with an overflow warning; selected
  identities remain available. Nodes combine their own and hosted signals using observation-time membership;
  association does not establish node causality.
- Namespace **Favourites**, **Recent**, and enabled **Tag** modes use current
  context selections, not historical preferences or tags. Tag resolution uses
  existing cached namespace inventory; label/annotation rules cannot match
  unavailable metadata. No live inventory request is made by History.
  **Favourites** and **Recent** are available only when their Dashboard namespace
  filter features are enabled; **Tag** requires resource tags enabled and defined.
  If a saved mode is unavailable (including a removed tag), History temporarily
  uses **Top signals 10** without replacing the saved ranking or selection. Re-enabling
  the feature or restoring the tag restores that choice. **Custom** remains available.
- Explicit selections are limited to 20 per chart. Namespace selections above
  that limit block the request with a warning rather than silently truncating.
- Charts hide series whose observed plotted values are all zero with complete
  coverage over the selected period. **Top signals 10** considers High + Medium + Low,
  not changes. Medium-only and Low-only series remain visible. Unknown-only series, incomplete zero subtotals,
  and earlier positive values are retained. A compact hidden-series note explains
  omissions; **Custom** checkboxes and selections stay unchanged. Severity keeps
  its three severity layers even at zero. Top signals and Custom remain line charts;
  Top Changes uses the positive-only rule above.
- Without retained evidence, values are gaps, never healthy zero. Last-known
  active values may carry forward with degraded coverage, never before the first
  observation. Partial observations keep their subtotals with per-point coverage markers.
  Legacy evidence without coverage is unknown, not complete. Larger intervals
  retain the last usable active counts and sum changes and first-seen signals separately. Changes
  can retain confirmed subtotals even without active counts; unknown changes
  remain gaps rather than zero. Active-count and Changes coverage are independent,
  and aggregation never promotes partial or unknown evidence to complete.
  For troubleshooting, the authenticated History API's optional
  `diagnostics=transitions` response includes bounded hourly explanations of why
  candidate changes were not confirmed, filterable by rule, namespace and Node
  identity. These explanations survive restart under the same retention policy;
  they do not reconstruct older missing evidence or turn uncertain changes into
  incidents. For a future image-pull jump, a retained example can distinguish
  a namespace omitted by a successful catalog read from a failed catalog read
  or a missing Pods snapshot. A missing example cannot distinguish these cases.
  Baseline observations are not incidents.
- Each chart's legend shows **Min**, **Avg**, **Max**, and **Last** for its
  displayed intervals. Unknown values are excluded from Min/Avg/Max; observed
  zeros are included. Last is the final displayed interval, with **—** for
  unknown rather than an earlier known value. Severity statistics describe each
  layer, not cumulative stack heights. Hover or keyboard-focus a legend row to
  emphasize its series, including coincident lines, without changing the data.
  Up to ten series fit without vertical scrolling; larger Custom or Tag legends
  scroll within the same bounded area. Shorter legends use only the space needed.
- Hover a chart or focus it and use <kbd>ArrowLeft</kbd>/<kbd>ArrowRight</kbd>
  to inspect the timestamp and each selected series’ signal or change count.
  Tooltip rows show the series label, value and unit without repeated coverage
  labels. Signal counts are last observed values, not live readings; Top Changes reports observed differences
  and first-seen signals, and may be incomplete. **No data** is a missing observation,
  never zero. The shared information tooltip explains these limits without
  repeating explanatory text below every chart. The diagnostic chips
  below the charts show the last observation, evaluated/eligible scopes and
  retained storage—not live cluster health. **Persisted** shows retained hourly
  records for this context, not the requested period, plus human-readable payload
  bytes across contexts. Its tooltip distinguishes payload from database size,
  which includes overhead and other history data. **Cap losses** appears only
  when history limits omitted data; zero losses are not a warning.
- History records the same **30 signal types** as Dashboard. The other **10 catalog
  rules** are outside that projection, not missing Dashboard observations or
  cluster faults. Their catalog count is not a chart warning. Partial and unknown
  observations remain marked independently; this is not full catalog coverage.
  Static policy and runtime suppression filters match Dashboard. Stale cached rows
  still count, with their original source timestamps; fresh, complete evidence is
  required to confirm disappearances. Unsupported rules are not healthy zeros.
  This describes what History can evaluate, not a cluster failure.
- Matching Dashboard counts means using the same captured evidence, evaluation time
  and policy. Each cache store is captured consistently, but stores are not captured
  atomically together; separate requests can observe different generations. History
  starts from current evidence as a baseline and never backfills earlier observations.
- If a query exceeds the memory limit, choose a shorter period or narrower date
  range. This limit message is different from an unavailable-storage error.
- Queries isolate the current history identity generation; retained records from
  older generations do not contribute identities, rankings, or observations.
  A retained hour with confirmed changes but no valid observation time is shown
  as unknown with `invalid-retained-hour`. Its original records are not changed.
  Individual transitions cannot be recovered reliably from such a mixed hour;
  correctly timestamped changes without active counts remain usable.
- An invalid-response error identifies the rejected field or consistency check.
  Charts remain hidden rather than displaying mismatched data. When reporting it,
  include that reason; do not share authentication tokens.
- History loads automatically when opened. While visible, trends reread the local
  persisted database 60 seconds after each completed read (including failures),
  with no overlapping active reads. No manual refresh button is needed.
  **Retry signals** is available on errors; **Retry choices** recovers failed
  cached-inventory reads. Neither retry nor automatic reads trigger collection,
  warm caches, or request Kubernetes resources.
  Hiding the document cancels its trend read and pauses the timer; returning
  resumes once. Context, credentials, selection and period changes cancel obsolete
  reads; leaving History cancels them too. Publication collection runs independently.

### Separate signal identity consent

In **Settings → Dataplane → History**, **Enable signal history** is a
separate opt-in, OFF by default. Opening History,
changing a profile, or enabling collection does not grant this permission.
Choose **Global defaults** or **This context**, enable collection too, and choose
retention. Edits autosave. Global consent covers inheriting contexts, including new
ones; each has its own server-generated identity, never a copied global epoch.

Settings changes, disabling/re-enabling and server restarts preserve existing
history identity. Use a distinct kubeconfig context for a different cluster:
kview cannot detect retargeting from the context name alone.

Consent stores context, names, namespaces, resource UIDs, rule/subtarget,
node membership and bounded transitions on this server. It does not store raw
manifests, secret or label maps. Retention is 30 or 90 days with bounded capacity;
no pre-consent history is reconstructed. History includes Node and namespace
signals from the full Dashboard population after Dashboard policy filters.
Disabling identity history stops that collection and denies its reads without
removing retained data. Data can remain beyond retention while
disabled. Permission/storage failures and unavailable evidence are not zero.

To check collection after enabling:

1. Select the intended context and visit **Namespaces** normally so its cache is
   populated. In **Settings → Dataplane → History**, enable both history
   checkboxes, choose retention, and wait for autosave confirmation.
2. Open the selected namespace's Pods or the Nodes view normally to populate
   fresh cache evidence. History itself does not fetch Kubernetes resources.
3. Collection follows published cache updates without making new Kubernetes
   requests. Open **History** or wait for its next automatic read, then inspect
   **Signal types** and the last observation below the charts. Bursts can be coalesced; publication-driven collection
   does not guarantee that every intermediate transition is captured.
4. Allow observations to accumulate. There is no pre-enable backfill; first
   observations are baselines, not new-incident events. Missing/partial coverage
   and unsupported rules are not proof of a healthy cluster.

### Collection settings

Open **Dashboard → History** to read stored history for the active context.
Collection and identity consent default OFF. Open **Settings → Dataplane → History**
and choose **Global defaults** or **This context**. Choose **History retention**
(30 or 90 days), enable collection and **Enable signal history**. Changes autosave
and are read back before confirmation. Global edits affect inheritors; context edits
override only changed fields. **Reset to global defaults** removes context overrides.
New contexts inherit explicit global defaults. No config copying or restart is needed.
Conflicts retain edits for **Retry settings** or **Discard edits**. If another
inheritor cannot start, its safe failure and recovery action remain visible even
when defaults saved durably and the selected collector is running.

History records the full Dashboard signal population after Dashboard policy
filters, including direct Node and namespace signals. There is no separate Node
switch or namespace collection filter. Dataplane enrichment affects upstream
cached data, not History admission; History never fetches additional Kubernetes
resources. Missing evidence does not prove disappearance or a healthy zero.
Changing a browser profile never grants history consent.

Settings are persisted on this server, not in browser profiles; saved enabled
contexts resume on restart.
Read-only mode locks editing.

To disable one context, choose **This context**, clear **Enable history for this context**
and wait for autosave. This joins the
worker and preserves its stored data, but history is not readable until this
context is re-enabled. Changing upstream enrichment does not erase retained
samples. Disabled settings survive restart. No pruning happens while
disabled: retained data can outlive the selected horizon until collection resumes.
Shorter retention prunes older data during successful publication or maintenance;
longer retention cannot restore deleted observations. Neither settings nor stored history is included in
browser profile exports.

The optional backend records published cache evidence. Retained last-known
active values can continue across quiet or unloaded periods, marked **Last known**,
with original observation times and degraded coverage. They are not fresh samples.
Before the first retained observation, values remain unknown. Confirmed changes
are independent of active counts; unknown changes are not zero. Coalescing and
queue overflow are shown in the diagnostics below the charts when reported.
History requests do not fetch Kubernetes data; the surrounding Dashboard retains its independent
metrics-capability check. History is not Prometheus or a continuous
current-cluster telemetry feed.

History never writes to Kubernetes. Viewing it does not enable collection; an
explicit checkbox change in the chosen settings scope controls consent.

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

Closing the dialog cancels its pending bundle request. Changing the signal or
active context replaces that request; a late response cannot replace the new
result. Saved snapshots remain local follow-up records, not active tasks.

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
