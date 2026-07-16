import{r as e}from"./rolldown-runtime-QTnfLwEv.js";import{$ as t,E as n,G as r,P as i,T as a,cn as o,rn as s,u as c,w as l}from"./mui-grid-vendor-BZ12xozU.js";import{d as u,f as d,y as f}from"./mui-vendor-Dp9Ma5dp.js";import{b as p,gt as m,st as h,x as g,y as _}from"./mui-icons-vendor-DK3mjlqY.js";import{N as v,l as y,s as b}from"./one-light-Q2Rig_j0.js";import{t as x}from"./CodeBlock-u_pDf1zk.js";import{B as S,L as C,R as w,z as T}from"./index-A-osQNjC.js";var E=e(o(),1),D=s();function O(e){let t=[],n=e.replace(/\r\n/g,`
`).split(`
`),r=[],i=[],a=null,o=``,s=()=>{r.length&&(t.push({type:`paragraph`,text:r.join(` `)}),r=[])},c=()=>{i.length&&(t.push({type:`list`,items:i}),i=[])};for(let e of n){let n=e.match(/^```([a-zA-Z0-9_-]*)\s*$/);if(n){a?(t.push({type:`code`,language:o||`text`,code:a.join(`
`)}),a=null,o=``):(s(),c(),a=[],o=n[1]||`text`);continue}if(a){a.push(e);continue}if(!e.trim()){s(),c();continue}let l=e.match(/^(#{1,3})\s+(.+)$/);if(l){s(),c(),t.push({type:`heading`,level:l[1].length,text:l[2]});continue}let u=e.match(/^-\s+(.+)$/);if(u){s(),i.push(u[1]);continue}if(/^\s{2,}\S/.test(e)&&i.length>0){i[i.length-1]=`${i[i.length-1]} ${e.trim()}`;continue}c(),r.push(e.trim())}return a&&t.push({type:`code`,language:o||`text`,code:a.join(`
`)}),s(),c(),t}function k(e){let t=[],n=/(<kbd>.*?<\/kbd>|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g,r=0,i;for(;i=n.exec(e);){i.index>r&&t.push(e.slice(r,i.index));let n=i[0];if(n.startsWith(`<kbd>`))t.push((0,D.jsx)(y,{label:n.replace(/^<kbd>/,``).replace(/<\/kbd>$/,``)},`${i.index}-kbd`));else if(n.startsWith(`**`))t.push((0,D.jsx)(f,{component:`strong`,sx:{fontWeight:700},children:n.slice(2,-2)},`${i.index}-bold`));else if(n.startsWith("`"))t.push((0,D.jsx)(f,{component:`code`,sx:{px:.5,py:.125,borderRadius:.75,bgcolor:`action.hover`,fontFamily:`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,fontSize:`0.86em`},children:n.slice(1,-1)},`${i.index}-code`));else{let e=n.match(/^\[([^\]]+)\]\(([^)]+)\)$/);e&&t.push((0,D.jsx)(d,{href:e[2],target:`_blank`,rel:`noreferrer`,children:e[1]},`${i.index}-link`))}r=i.index+n.length}return r<e.length&&t.push(e.slice(r)),t}function A({markdown:e}){return(0,D.jsx)(f,{sx:{display:`flex`,flexDirection:`column`,gap:1.25},children:O(e).map((e,t)=>e.type===`heading`?(0,D.jsx)(r,{variant:e.level===1?`h5`:e.level===2?`h6`:`subtitle1`,component:e.level===1?`h1`:e.level===2?`h2`:`h3`,sx:{mt:t===0?0:1.25,fontWeight:700},children:e.text},`heading-${t}`):e.type===`list`?(0,D.jsx)(f,{component:`ul`,sx:{m:0,pl:2.5,display:`flex`,flexDirection:`column`,gap:.5},children:e.items.map((e,t)=>(0,D.jsx)(f,{component:`li`,sx:{pl:.25},children:(0,D.jsx)(r,{variant:`body2`,children:k(e)})},`${e}-${t}`))},`list-${t}`):e.type===`code`?(0,D.jsx)(x,{code:e.code,language:e.language,showCopy:!1},`code-${t}`):(0,D.jsx)(r,{variant:`body2`,color:`text.primary`,children:k(e.text)},`paragraph-${t}`))})}var j={version:1,title:`kview Help`,externalLinks:{github:`https://github.com/korex-labs/kview`,website:`https://korex-labs.com`,patreon:`https://www.patreon.com/cw/KorexLabs`},pages:[{id:`getting-started`,title:`Getting Started`,category:`Basics`,source:`getting-started.md`,surfaces:[`app`,`repo`,`website`]},{id:`navigation`,title:`Navigation`,category:`Basics`,source:`navigation.md`,surfaces:[`app`,`repo`,`website`]},{id:`views-and-resources`,title:`Views And Resources`,category:`Resources`,source:`views-and-resources.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-lists`,title:`Resource Lists`,category:`Resources`,source:`resource-lists.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-drawers`,title:`Resource Drawers`,category:`Resources`,source:`resource-drawers.md`,surfaces:[`app`,`repo`,`website`]},{id:`dashboard-and-signals`,title:`Dashboard And Signals`,category:`Resources`,source:`dashboard-and-signals.md`,surfaces:[`app`,`repo`,`website`]},{id:`actions-and-safety`,title:`Actions And Safety`,category:`Workflows`,source:`actions-and-safety.md`,surfaces:[`app`,`repo`,`website`]},{id:`workflows`,title:`Common Workflows`,category:`Workflows`,source:`workflows.md`,surfaces:[`app`,`repo`,`website`]},{id:`activity-panel`,title:`Activity Panel`,category:`Workflows`,source:`activity-panel.md`,surfaces:[`app`,`repo`,`website`]},{id:`pods-workloads`,title:`Pods And Workloads`,category:`Resources`,source:`pods-workloads.md`,surfaces:[`app`,`repo`,`website`]},{id:`networking`,title:`Networking`,category:`Resources`,source:`networking.md`,surfaces:[`app`,`repo`,`website`]},{id:`policy`,title:`Policy`,category:`Resources`,source:`policy.md`,surfaces:[`app`,`repo`,`website`]},{id:`namespaces`,title:`Namespaces`,category:`Resources`,source:`namespaces.md`,surfaces:[`app`,`repo`,`website`]},{id:`helm`,title:`Helm`,category:`Resources`,source:`helm.md`,surfaces:[`app`,`repo`,`website`]},{id:`rbac`,title:`RBAC`,category:`Resources`,source:`rbac.md`,surfaces:[`app`,`repo`,`website`]},{id:`storage`,title:`Storage`,category:`Resources`,source:`storage.md`,surfaces:[`app`,`repo`,`website`]},{id:`custom-resources`,title:`Custom Resources`,category:`Resources`,source:`custom-resources.md`,surfaces:[`app`,`repo`,`website`]},{id:`settings`,title:`Settings`,category:`Configuration`,source:`settings.md`,surfaces:[`app`,`repo`,`website`]},{id:`smart-filters`,title:`Smart Filters`,category:`Configuration`,source:`smart-filters.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-tags`,title:`Resource Tags`,category:`Configuration`,source:`resource-tags.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-macros-dynamic-links`,title:`Resource Macros And Dynamic Links`,category:`Configuration`,source:`resource-macros-dynamic-links.md`,surfaces:[`app`,`repo`,`website`]},{id:`custom-commands-actions`,title:`Custom Commands And Actions`,category:`Configuration`,source:`custom-commands-actions.md`,surfaces:[`app`,`repo`,`website`]},{id:`dataplane-settings`,title:`Dataplane Settings`,category:`Configuration`,source:`dataplane-settings.md`,surfaces:[`app`,`repo`,`website`]},{id:`import-export`,title:`Import / Export`,category:`Configuration`,source:`import-export.md`,surfaces:[`app`,`repo`,`website`]},{id:`troubleshooting`,title:`Troubleshooting`,category:`Support`,source:`troubleshooting.md`,surfaces:[`app`,`repo`,`website`]},{id:`whats-new`,title:`What's New`,category:`Updates`,source:`whats-new.md`,surfaces:[`app`,`repo`,`website`]}],featuredPages:[`getting-started`,`dashboard-and-signals`,`workflows`,`actions-and-safety`,`whats-new`]},M={"actions-and-safety":`# Actions And Safety

kview supports read-heavy exploration first, with guarded actions for common
operator tasks.

## What This Is For

Actions let users mutate selected Kubernetes resources or start local runtime
sessions while keeping review, RBAC, and confirmation visible.

## Capability-Aware Actions

Action buttons are based on Kubernetes permissions and backend capability
checks. If an action is not allowed, kview hides or disables the control and
shows the denial reason when available.

## Common Actions

Depending on resource type and permissions, actions may include:

- Delete
- Restart
- Scale
- Port forward
- Container command presets
- Workload action presets
- RBAC operations
- Helm install, upgrade, and uninstall

## Common Workflows

Mutating operations go through a review dialog. Destructive or high-impact
changes require explicit confirmation before kview sends the request.

## YAML Patching

Supported resources can be patched from the YAML tab. The patch flow opens the
loaded YAML in an editor, keeps the resource identity fixed, validates the
generated merge patch before applying, warns about risky fields, and uses
confirmation before live apply.

If Kubernetes rejects the patch because the resource changed, reload the YAML,
review the diff and generated patch, and apply again only after confirming the
new state.

## Custom Commands And Actions

Custom container commands and workload action presets are configured in
Settings. Keep presets specific and descriptive so future users understand the
target and impact before running them.

## Permission And Data Notes

Action availability depends on Kubernetes RBAC and on the selected resource
type. kview does not show an action just because the UI knows how to render it;
the backend capability check must allow it for the active context and target.

## Related Settings

- **Custom Commands**
- **Custom Actions**
`,"activity-panel":`# Activity Panel

The Activity Panel is the fixed bottom panel for background work, runtime
sessions, port forwards, and kview runtime logs.

## What This Is For

Use the Activity Panel to monitor work that continues after the original action
starts, such as dataplane snapshots, namespace enrichment, terminal sessions,
and port forwards.

## Main Controls

- **Collapse / expand**: use the chevron button or double-click the panel
  header.
- **Resize**: drag the top edge of the open panel.
- **Status area**: shows backend and cluster status dots plus active context
  details on hover.
- **Tabs**: switch between **Activities**, **Work**, **Terminals**,
  **Port forwards**, and **Logs**.

## Tabs

**Activities** shows recent and active runtime operations. Rows include type,
resource, target, status, duration, and actions for terminal, port-forward, and
log-related entries.

**Work** shows dataplane scheduler state. It separates running and queued work
and includes cluster, kind, namespace, priority, source, queued time, running
time, and work key.

**Terminals** shows open terminal sessions. Multiple terminal sessions can be
open at once and are represented as tabs inside the Activity Panel.

**Port forwards** shows active port-forward sessions with local endpoint,
remote port, service, pod, and actions to open or stop the forward.

**Logs** shows kview runtime log entries. It auto-scrolls while the user is at
the bottom of the log table.

## Optional Behavior

kview remembers whether the Activity Panel is open or collapsed from direct
interaction. kview also remembers the last resized panel height. This is local
UI state, not an Appearance form setting.

The panel is covered by full-surface views such as Settings and Help so it does
not overlap those screens.

## Keyboard Shortcuts

- <kbd>Alt+A</kbd> or <kbd>g a</kbd>: toggle the panel
- <kbd>Alt+1</kbd> or <kbd>g 1</kbd>: open **Activities**
- <kbd>Alt+2</kbd> or <kbd>g 2</kbd>: open **Work**
- <kbd>Alt+3</kbd> or <kbd>g 3</kbd>: open **Terminals**
- <kbd>Alt+4</kbd> or <kbd>g 4</kbd>: open **Port forwards**
- <kbd>Alt+5</kbd> or <kbd>g 5</kbd>: open **Logs**

## Permission And Data Notes

The panel reflects runtime state from the local kview backend. Terminal and
port-forward rows appear only when those sessions exist and are allowed by the
selected resource and RBAC permissions.

## Related Settings

- **Dataplane**
- **Keyboard**
`,"custom-commands-actions":`# Custom Commands And Actions

Custom Commands and Custom Actions let users define reusable operator workflows
from Settings.

## What This Is For

Use custom definitions when your team repeats the same container inspection
command or workload patch often enough that it should be available from kview.

## Custom Commands

Custom Commands run against matching pod containers. A command definition
includes target matching rules, command text, output type, and safety level.
Commands are executed with \`/bin/sh -lc\` inside the selected container.

Output types change how kview presents the result:

- **text**: shows stdout as plain text with copy support.
- **keyValue**: parses stdout as key-value rows. If stdout is not parseable,
  kview falls back to plain text and shows an info message.
- **csv**: parses stdout as a delimited table. kview detects comma, tab, or
  other supported delimiters and falls back to plain text when the output is
  not table-shaped.
- **code**: shows stdout in a syntax-highlighted code block. Set **Code
  language** for a specific highlighter such as \`json\`, \`yaml\`, \`shell\`, or
  leave it blank for auto-detection.
- **file**: treats stdout as downloadable output instead of rendering it in the
  dialog. Set **File name** for the downloaded name and optionally enable
  **Compress with gzip**.

The command output dialog includes an output filter for rendered output types.
For **keyValue** output, **Pretty values** reuses the same prettifier used by
Pod environment variables: exact boolean-like values and log-level values are
shown as chips, and \`http://\` or \`https://\` values become clickable links.

## Custom Actions

Custom Actions apply configured workload changes. Supported definitions include
setting environment variables, unsetting environment variables, changing images,
and applying JSON or merge patches.

## Optional Behavior

Custom definitions do nothing until a matching resource exposes them. If a
command or action is scoped narrowly, it appears only for matching targets. If
RBAC or backend capability checks do not allow the operation, kview hides or
disables the action.

Container matching is optional. Leave **Container pattern** blank to make a
command available on every actionable container, or provide a regular
expression to limit where it appears. Invalid regular expressions are reported
in Settings.

Safety controls alter confirmation behavior. **Safe** commands use simple
confirmation. **Dangerous** commands require typed confirmation before
execution.

## Common Workflows

- Keep names clear and specific.
- Scope commands and actions to the smallest useful set of resources.
- Mark dangerous commands clearly.
- Use **keyValue** for environment-like output such as \`/bin/env\`.
- Use **file** with **Compress with gzip** for large diagnostic dumps that are
  easier to inspect outside kview.
- Test definitions on a non-production namespace before relying on them during
  an incident.
- Export settings to share definitions between browser profiles.

## Permission And Data Notes

Custom Commands can start container exec sessions. Custom Actions can mutate
Kubernetes workloads. Both depend on the selected resource, active context, and
RBAC permissions.

## Related Settings

- **Custom Commands**
- **Custom Actions**
- **Import / Export**
`,"custom-resources":`# Custom Resources

Custom Resource views help inspect CRDs and custom resources without
kview-specific code for every custom kind.

## What This View Is For

Use Custom Resources when a cluster contains operators or platform APIs that
create non-core Kubernetes resource kinds.

Custom resources live under **Extensions** in the sidebar because they are
discovered through Kubernetes API extensions rather than the built-in workload,
configuration, storage, or policy APIs.

## Resource Views

- **Custom Resource Definitions**: cluster-scoped CRD definitions.
- **Custom Namespace Resources**: namespaced custom resources discovered from
  visible CRDs.
- **Custom Cluster Resources**: cluster-scoped custom resources discovered from
  visible CRDs.

## Main Controls

Custom resource lists support filtering and drawer inspection like other
resource lists. Drawers emphasize metadata, status, events where available, and
YAML.

Custom resource drawers also support:

- **Actions**: delete a custom resource instance when RBAC allows it.
- **Tags**: view and edit kview resource tags from the drawer header.
- **Macros**: assign resource macros for custom-resource scopes.
- **Dynamic links**: use labels and annotations in drawer link templates.
- **YAML**: inspect, edit, and apply full custom-resource YAML.

## Common Workflows

- Open CRDs to understand available custom kinds.
- Use namespace or cluster custom resource views to inspect instances.
- Filter by kind, name, namespace, or tag.
- Tag important custom resources so they are easier to find across list views.
- Use macros or dynamic links for operator-specific dashboards, logs, or runbooks.
- Use YAML for full custom-resource state when no specialized panel exists.

## Permission And Data Notes

Custom resource discovery depends on access to CRDs and the custom resource
endpoints. Some CRDs may be visible while their instances are not, or vice
versa, depending on RBAC.

## Related Settings

- **Resource Tags**
- **Dataplane**
`,"dashboard-and-signals":`# Dashboard And Signals

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
`,"dataplane-settings":`# Dataplane Settings

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
- **Dashboard signal limits**: control how many top-priority and newest
  dashboard signals are shown by the matching dashboard filters.

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

Dashboard signal limits are optional triage controls. **Signal limit** caps the
top-priority dashboard set, while **Newest signal limit** caps the newest
detected signal set.

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
`,"getting-started":`# Getting Started

kview is a local Kubernetes UI for fast cluster exploration. It reads your
kubeconfig, starts a local server, and opens the UI in a browser or desktop
webview depending on how the binary was built.

## Download A Release

Tagged releases are available from
[GitHub Releases](https://github.com/korex-labs/kview/releases). Choose the regular
binary for browser/server mode on Linux, macOS, or Windows.

Linux amd64 and macOS releases also include desktop assets named:

\`\`\`text
kview-<version>-linux-amd64-webview
kview-<version>-darwin-amd64-webview
kview-<version>-darwin-arm64-webview
\`\`\`

They open the embedded UI in a native window by default. The Linux asset requires
GTK 3 and WebKitGTK 4.1 runtime libraries on the host. The macOS assets use the
system WebKit framework and do not need a separate WebKit installation. Choose
\`darwin-amd64\` for an Intel Mac or \`darwin-arm64\` for Apple Silicon.

The macOS assets are ad-hoc signed but not Apple-notarized. Depending on your
Gatekeeper policy, the first launch may require approving kview in **System
Settings → Privacy & Security**. Webview assets for Linux arm64 and Windows are
not published yet; use the regular release binary on those platforms.

After downloading a Linux or macOS binary, make it executable before running it:

\`\`\`bash
chmod +x kview-*
\`\`\`

## First Run

Start kview from a shell that can already access your Kubernetes contexts:

\`\`\`bash
kview
\`\`\`

If you need a specific kubeconfig file or directory, pass \`--config\`:

\`\`\`bash
kview --config ~/.kube/my-config
\`\`\`

kview uses the same client-go authentication flow as other Kubernetes tools. If
your kubeconfig uses an exec auth plugin, the referenced command must be
installed and available on \`PATH\`.

## Kubeconfig Resolution

kview resolves kubeconfig locations in this order:

1. \`--config\`
2. \`KUBECONFIG\`
3. the default kubeconfig path, usually \`~/.kube/config\`

\`--config\` and \`KUBECONFIG\` can point to one file, one directory, or multiple
locations separated by the operating system path-list separator. On Linux and
macOS that separator is \`:\`. On Windows it is \`;\`.

When a location is a file, kview reads that file. When a location is a
directory, kview reads the files directly inside that directory in name order.
Directory loading is not recursive: nested directories are skipped. Missing
locations are skipped and reported in startup logs.

The resolved files are passed to Kubernetes client-go as the kubeconfig loading
precedence. Local paths inside kubeconfig files are resolved by client-go. For
exec authentication plugins, kview also provides the effective kubeconfig file
list through \`KUBECONFIG\` unless the exec environment already defines it.

The startup dialog shows the default path and the exact readable files kview
resolved for the current run.

## What To Check First

- Use the context selector to choose the cluster you want to inspect.
- Choose a namespace for namespaced resources.
- Open Dashboard for cluster-level health and attention signals.
- Open Pods, Deployments, Services, Ingresses, or Helm Releases for common
  day-to-day views.
- Select a row to open its drawer, then use tabs for overview, related
  resources, events, metadata, and YAML.

## Permissions

kview adapts to your Kubernetes permissions. If your account cannot list a
resource, the UI shows an access-denied state instead of failing the whole app.
Mutation buttons are hidden or disabled when RBAC does not allow the action.
`,helm:`# Helm

Helm views cover releases and derived chart catalog rows.

## What This View Is For

Use Helm views to inspect release status, chart identity, namespaces, related
Kubernetes resources, and Helm actions when available.

## Helm Releases

Helm Releases are namespaced. Release drawers show status, chart/app versions,
manifest-derived resources, metadata, YAML where available, and actions such as
upgrade or uninstall when permissions allow.

## Helm Charts

Helm Charts are derived from cached release snapshots. Chart rows group release
data by chart name and version so users can see where a chart is deployed
across visible namespaces. When Resource Tags are enabled, chart list rows keep
the chart name first and show tags next to it like other resource lists.

Open a chart and select **Versions** to inspect one chart version at a time.
The version detail shows the exact namespaces and Helm releases using that
version. When release storage is visible, selecting a release also shows the
manifest rendered from the deployed Helm release, which is useful when direct
chart inspection is not available.

If the chart row itself is derived from cached release snapshots, the chart
detail may initially be sparse. Selecting a release can still load the manifest
from that Helm release's namespaced detail view when permissions allow it.

## Optional Behavior

Helm chart catalog data depends on dataplane snapshots. It may be stale,
partial, or unavailable when release secrets are not visible.

## Common Workflows

- Filter releases by chart, namespace, status, or tag.
- Open a stale or failed release from Dashboard signals.
- Open a chart version to compare where it is deployed and review the
  release-backed manifest for a selected release.
- Inspect manifest resources to jump from Helm to the underlying Kubernetes
  objects.
- Review release status and related resources before uninstalling or upgrading.

## Permission And Data Notes

Helm data is usually read from Kubernetes Secrets. If the active account cannot
read those secrets, Helm views may be empty or partial. Helm mutations depend on
the configured action and Kubernetes permissions.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Actions And Safety**
`,"import-export":`# Import / Export

Import / Export moves kview settings between browser profiles or backs up the
current local profile.

## What This Is For

Use Import / Export when you want to share selected local configuration with
another operator, move settings to another browser profile, or keep a full
backup before changing a profile.

## Transfer Bundles

Transfer bundles are section-based and are the preferred format for sharing
settings with a team. A transfer bundle can include only the sections selected
at export time.

Exportable sections include Smart Filters, Resource Tags, Resource Macros,
Dynamic Links, Saved Views, Custom Commands, Custom Actions, Dataplane signal
settings, favourite namespaces, recent namespaces, signal acknowledgements when
available, bounded **Signal memory**, and saved Investigation Snapshots.

When importing a transfer bundle, kview detects the bundle and opens a review
dialog. The dialog shows the available sections, lets you choose which sections
to import, and applies the selected merge strategy.

## Merge Strategies

Merge strategies decide how imported sections interact with local settings:

- **Use imported**: replace matching local data with the imported data.
- **Keep mine**: keep local data when both profiles contain the same item.
- **Replace selected sections**: replace the selected local sections with the imported sections.

For Investigation Snapshots, conflicts are detected by snapshot id when present
and otherwise by context, primary resource, title, and creation time. **Keep
mine** skips matching local snapshots, **Use imported** writes the imported copy,
and **Replace selected sections** removes matching-context local snapshots before
importing the bundle.

Use **Use imported** when you trust the source profile and want to match it.
Use **Keep mine** when you are trying a shared bundle without overwriting local
customizations. Use **Replace selected sections** when the imported bundle should
be the source of truth for the selected sections.

## Full Profile Backup

Full profile export writes the complete kview user settings profile. This is
useful for backup and restore, but it is broader than a transfer bundle. A full
profile import replaces the current settings profile after confirmation.

## Common Workflows

- Export a transfer bundle with only **Custom Commands** and **Custom Actions**
  to share operator workflows without changing someone else's UI preferences.
- Export **Resource Tags** and favourites when moving investigation context to
  another browser profile.
- Export **Saved Views** to share both resource-list layouts and dashboard
  signal views without changing broader operator settings.
- Export **Signal memory** to preserve bounded distinct observation days during
  profile transfer. Import honours the selected conflict strategy. In Dataplane →
  Signals, **Reset context memory** removes all signal history for the active
  context after confirmation; restore requires an exported transfer bundle.
- Export **Investigation Snapshots** when handing off recurring incident context,
  known-fix notes, or a browser profile used during an incident review.
- Export **Resource Macros** and **Dynamic Links** to share external-link
  templates without changing someone else's local UI preferences.
- Export a full profile before testing broad Dataplane or signal changes.
- Review transfer bundle sections before importing and select only the parts
  you expect to change.

## Permission And Data Notes

Import / Export changes local kview settings and local operator knowledge only.
It does not write to Kubernetes resources. Investigation Snapshot import/export
uses kview's local snapshot store; imported snapshots can appear in resource
Notes, Search, and Activity, but they are never written as Kubernetes
annotations or labels. Imported Custom Commands and Custom Actions can later
trigger Kubernetes API calls or container exec sessions only when a user runs
them and RBAC allows the operation.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Resource Macros And Dynamic Links**
- **Custom Commands**
- **Custom Actions**
- **Dataplane**
`,namespaces:`# Namespaces

Namespaces provide scope-level summaries for namespaced resources.

## What This View Is For

Use Namespaces to find active, unhealthy, empty, or resource-heavy namespaces
and drill into the resources behind those summaries.

## List Columns And Filters

The namespace list can include health, age, workload counts, Helm releases,
RBAC counts, resource coverage, and favourite state depending on available
dataplane data.

Filtering can match namespace names and, when Resource Tags are enabled,
assigned namespace tags.

The **Quota** column is populated by progressive namespace row enrichment. It
shows ResourceQuota and LimitRange counts as \`ResourceQuotas / LimitRanges\`.
When ResourceQuota usage is available, the chip can include the highest usage
percentage and switch to warning or critical state. Rows that are still waiting
for enrichment show \`-\`.

## Drawer Tabs

Namespace drawers summarize workload health, signals, related resource counts,
events, metadata, and YAML. Namespace insights can link from a namespace-level
signal to the exact resource that contributed to it when that identity is
available.

The namespace **Signals** section uses the same signal action pattern as the
dashboard: severity, acknowledgement, and investigation. When a namespace list
row reports a signal because a contained resource needs attention, the drawer
also includes a fallback signal for that problematic resource so the list badge
and drawer signal table stay aligned.

The **Capacity** tab shows:

- namespace resource usage from cached pod metrics when metrics.k8s.io is
  available and allowed
- ResourceQuota count, LimitRange count, and warning or critical quota entry
  counts
- each ResourceQuota entry with used value, hard limit, and usage gauge when a
  ratio can be calculated
- each LimitRange item with min, max, default, and default request values

Quota pressure uses the same percent thresholds exposed by signal
customization. By default, entries at or above \`80%\` are warning and entries at
or above \`90%\` are critical.

## Common Workflows

- Favourite namespaces you inspect often.
- Enable **Smart namespace sorting** to promote favourites and recent
  namespaces in the namespace selector.
- Open namespace signals from Dashboard and inspect the related namespace
  drawer.
- Use the namespace list **Quota** column to find namespaces with quota
  pressure before opening the drawer.
- Open **Capacity** when you need the exact ResourceQuota key, used value, hard
  limit, or LimitRange default that produced a warning.
- Use namespace tags to mark ownership or investigation state locally.

## Permission And Data Notes

Namespace summaries depend on visible namespaced resources. If the active
account can list namespaces but not related workloads, counts and signals may
be partial. Quota and limit information requires access to ResourceQuota and
LimitRange resources in the namespace. Resource usage requires metrics.k8s.io
and RBAC for the relevant metrics reads.

## Related Settings

- **Smart namespace sorting**
- **Dashboard favourite namespace filters**
- **Dashboard recent namespace filters**
- **Resource Tags**
- **Dataplane**
`,navigation:`# Navigation

kview is organized around a left sidebar, dense resource lists, and right-side
drawers.

## What This Is For

Navigation keeps cluster scope, namespace scope, resource views, background
activity, and search reachable without leaving the current workflow.

## Sidebar

The sidebar contains:

- Kubernetes context selector
- Namespace selector or manual namespace input
- Resource groups: Workloads, Networking, Configuration, Access Control,
  Storage, Helm, Extensions, and Cluster
- Recent resource sections when the optional Recent menu setting is enabled

Cluster-scoped views do not use a namespace. Namespaced views use the active
namespace from the sidebar.

The selected context and namespace are saved locally and restored on the next
app start when they are still available. If the saved namespace no longer
exists in the selected context, kview falls back to the context default
namespace or \`default\`.

Resource groups in the sidebar can be collapsed or expanded. kview remembers
collapsed group state locally, so the sidebar keeps the same shape after a
restart.

## Optional Behavior

The namespace selector normally sorts namespaces alphabetically. If **Smart
namespace sorting** is enabled in Settings, favourites and recently used
namespaces are promoted ahead of the remaining namespace list.

The Recent section is optional and disabled by default. When enabled, it appears
above the normal resource groups and contains recently opened resource sections.
The number of entries is controlled by **Recent menu limit**.

## Resource Lists

Resource list pages use the same pattern:

- Toolbar for search, filters, and refresh
- Dense table for resource rows
- Status metadata about freshness and partial data when available
- Row selection that opens a resource drawer

Most lists support text filtering and sorting. Some lists also expose generated
quick filters from the dataplane.

Generated quick filters depend on the optional **Smart Filters** setting. When
Smart Filters are enabled, kview evaluates configured rules against list rows
and shows a chip only when enough rows match the generated label. When Smart
Filters are disabled, the text filter still works and generated chips are
hidden.

Resource tag columns depend on the optional **Resource Tags** setting. When tags
are disabled, list columns and drawer tag controls are hidden. When tags are
enabled, supported lists include a **Tags** column and \`tag:<name>\` text
filtering can match assigned or inherited tags.

## Drawers

Drawers keep the list visible while showing resource details. The Overview tab
focuses on operational state first: actions, attention signals, unhealthy
conditions, current state, and recent warnings.

Resource drawers also add **Notes** to the same tab strip as Overview, Events,
Metadata, and YAML. When a resource already has saved notes, the resource list
shows a **Notes** triage chip on that row and the Notes tab shows the same
triage state. This tab stores local operator knowledge about the selected
object. Use **Triage state** to record how operators should treat the object:
**Watch item**, **Known behavior**, **Do not touch**, **Investigating**, or
**Resolved**. Use **Operator note** for the short context or decision, and
**Reference link** for an optional runbook, ticket, dashboard, or docs URL.
Notes are keyed by context, resource kind, namespace, and name; they stay local
to the browser and are not written back to Kubernetes annotations.

The trailing tabs usually contain Events, Metadata, and YAML. Supported
resources may expose guarded YAML editing from the YAML tab.

Resource drawers can be resized by dragging the left edge. The width is saved
locally and reused for later drawers.

## Activity Panel

The Activity Panel is the bottom panel that tracks background work and live
runtime sessions. It stays aligned with the main content area and can be
collapsed, expanded, or resized vertically.

The panel tabs are:

- **Activities**: recent and active runtime operations such as terminal
  sessions, port forwards, dataplane snapshots, namespace enrichment, saved
  investigation snapshots, runtime logs, and connectivity events.
- **Work**: current dataplane scheduler work, including running and queued
  snapshot tasks, cluster, kind, namespace, priority, source, wait time, and
  running time.
- **Terminals**: open terminal sessions started from supported resource actions.
  Multiple terminals can be open at once and are shown as tabs inside the
  panel.
- **Port forwards**: active port-forward sessions with local endpoint, remote
  port, target service or pod, and actions to open or stop the forward.
- **Logs**: kview runtime log entries.

The Activity Panel header also shows backend and cluster status dots. Hover the
status area to see the current backend, cluster, and context details.

Double-click the panel header or use the expand/collapse button to toggle the
panel. Drag the top edge of the open panel to resize it. kview remembers the
open or collapsed state and the last selected height locally.

Keyboard shortcuts can also control the panel: <kbd>Alt+A</kbd> toggles it,
<kbd>Alt+1</kbd> through <kbd>Alt+5</kbd> open the Activities, Work,
Terminals, Port forwards, and Logs tabs, and <kbd>g a</kbd> / <kbd>g 1</kbd>
through <kbd>g 5</kbd> provide command-style alternatives.

## Search And Commands

Use the header **Search or command** input to find resources from cached
dataplane snapshots, saved investigation snapshots, or jump to resource views,
namespaces, contexts, and settings. Cached resource results can match by name,
namespace, kind, or cached health/signal context. Saved investigation results
match local snapshot titles, triage state, signal/resource identity, related
signal types, and operator notes; selecting one opens its primary resource.
Result rows show kind and match-reason chips, namespace scope, and any cached
health, status, or signal chips so failing resources stand out before you open
the drawer. Press <kbd>Ctrl+K</kbd> to focus it. Type <kbd>:</kbd> to show
command suggestions.

Use <kbd>/</kbd> to focus the current table filter. Table filters narrow the
visible list and are separate from cached dataplane search.

Press <kbd>?</kbd> in the app to show keyboard shortcuts. Some shortcuts are
optional: Settings can disable single-letter global search (<kbd>s</kbd>) and
the extra <kbd>h/j/k/l</kbd> or <kbd>a/s/d/f</kbd> table navigation bindings.
Arrow-key table navigation and <kbd>Ctrl+K</kbd> header search access remain
available.

## Related Settings

- **Smart namespace sorting**
- **Recent menu**
- **Recent menu limit**
- **Smart Filters**
- **Resource Tags**
- **Keyboard**
`,networking:`# Networking

Networking views cover Services and Ingresses.

## What This View Is For

Use Networking views to trace traffic routing from Kubernetes Service or
Ingress objects to selected pods, backends, endpoints, hosts, and TLS entries.

## Services

Service views focus on type, cluster IP, ports, selectors, endpoint readiness,
and related pods or workloads. They are useful when a workload is running but
traffic does not appear to reach it.

## Ingresses

Ingress views focus on class, hosts, addresses, TLS, rules, default backends,
and backend service readiness. kview surfaces routing warnings when backend
services or ready endpoints are missing.

## Common Workflows

- Start from an Ingress and inspect backend services.
- Open a Service and verify selectors and endpoint readiness.
- Navigate from related pods back to workload drawers for logs and conditions.
- Use events and YAML when routing behavior does not match the expected spec.

## Permission And Data Notes

Networking diagnosis often depends on reading related resources. If kview can
read the Service but not pods or endpoints, related sections may be partial or
empty. The view reflects visible Kubernetes data only.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Dataplane**
`,policy:`# Policy

Policy views cover Network Policies, ResourceQuotas, and LimitRanges.

## What This View Is For

Use Policy views to inspect namespace traffic rules, quota usage, and default
resource constraints that can affect scheduling, startup, or connectivity.

## Network Policies

NetworkPolicy views are namespaced. They show selected pods, policy types,
ingress and egress rule counts, rule peers, rule ports, events, metadata, and
YAML. The drawer includes delete and YAML apply actions when permissions allow.
The namespace in the drawer links back to the Namespace detail view.

## ResourceQuotas

ResourceQuota views are namespaced. They show quota keys, used and hard values,
highest usage, gauges for quota entries that report ratios, events, metadata,
and YAML. The drawer includes delete and YAML apply actions when permissions
allow. Namespace capacity summaries and ResourceQuota signals can open the
matching ResourceQuota drawer directly.

## LimitRanges

LimitRange views are namespaced. They show limit item types plus configured
min, max, default, default request, and max limit ratio values, events,
metadata, and YAML. The drawer includes delete and YAML apply actions when
permissions allow. Namespace capacity summaries can open the matching
LimitRange drawer directly.

## Common Workflows

- Use Network Policies when traffic works in one namespace but not another.
- Use ResourceQuotas when pods fail to schedule or create due to namespace
  capacity limits.
- Use LimitRanges when workloads inherit unexpected default requests or limits.
- Check YAML when selector or rule summaries do not explain behavior.
- Use Namespace inventory and capacity links to move between namespace context
  and the exact Policy resource.

## Permission And Data Notes

Selected pod counts are best-effort and require pod list access in the
namespace. If pod reads are denied, the policy object is still shown without
selector match counts.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Actions And Safety**
`,"pods-workloads":`# Pods And Workloads

Pods and workload views cover day-to-day application inspection.

## What This View Is For

Use these views to inspect runtime state, readiness, images, restarts,
conditions, related pods, events, logs where available, and YAML.

## Resource Views

- **Pods**: individual running or completed pod instances.
- **Deployments**: rollout and replica state for Deployment workloads.
- **Stateful Sets**: ordered workload state and related pods.
- **Daemon Sets**: node-wide workload coverage and pod state.
- **Replica Sets**: replica controller state, usually owned by Deployments.
- **Jobs**: batch execution state.
- **Cron Jobs**: scheduled Job configuration and recent execution state.
- **HPA**: Horizontal Pod Autoscaler state and scaling targets.

## Drawer Tabs

Workload drawers focus on status first, then related resources. Pod drawers own
direct log streaming. Workload drawers that do not stream logs navigate to pods
for log inspection.

Pod drawer **Logs** controls include:

- **Container**: selects which container log stream to show.
- **Lines**: chooses the requested tail size. Available values are \`100\`,
  \`500\`, \`1000\`, and \`5000\`.
- **Filter pattern**: filters currently buffered log lines by text.
- **Pretty**: attempts to pretty-print JSON log lines. Lines that are not JSON
  stay as text.
- **Wrap lines**: wraps long log lines inside the log panel.
- **Follow**: opens or closes the live log stream. <kbd>L</kbd> opens the Logs
  tab and starts following when a Pod drawer is focused.

Logs depend on Pod log access for the selected container. kview streams current
container logs; it does not expose previous-container logs as a separate toggle.

## Jobs And Cron Jobs

Job drawers include **Rerun**. This creates a fresh Job from the selected Job's
pod template. CronJob drawers include **Run now**. This creates a one-off Job
from the selected CronJob's job template. CronJob drawers also include
**Suspend** or **Resume** based on the current \`spec.suspend\` state. This is a
temporary live change to the Kubernetes object; Helm or another reconciler may
overwrite it on the next sync or upgrade.

Both actions include the optional **Open debug run** checkbox. When enabled,
kview starts the Job and opens a debug dialog that streams:

- **Timeline**: creation, status, warning, and error records.
- **Logs**: container log lines from the debug run.
- **Events**: Kubernetes events observed for the run.

The debug dialog includes **Stop job**. Press it once to arm the destructive
action, then press **Confirm stop job** to stop the debug Job. Closing the
dialog stops watching the debug session; it does not mean the normal Job or
CronJob action succeeded without checking the final Job state.

## Common Workflows

- Open **Dashboard** signals for pod restarts, CrashLoopBackOff, image pull
  failures, unschedulable pods, or workload availability.
- Navigate to the workload list and filter by namespace, name, image, status,
  or tag.
- Open a drawer and review **Overview**, **Conditions**, **Events**, and
  related pods.
- For logs, open the relevant pod drawer, choose the container, and use
  **Follow** only while you need live updates.
- Use **Rerun** or **Run now** for batch workloads when you need a new Job from
  the existing template. Use **Open debug run** when you also want live status,
  events, and logs for that manual run.
- Use guarded actions such as restart, scale, delete, terminal, port forward,
  or custom commands only after reviewing current state.

## Permission And Data Notes

Workload actions depend on RBAC. Logs, terminal sessions, and port forwards may
require permissions beyond list/read access. Job rerun, CronJob run, and debug
run actions require permission to create Jobs in the namespace. Stopping a
debug run requires permission to stop or delete the generated Job. CronJob
suspend and resume require patch or update permission on CronJobs. Metrics
appear only when metrics.k8s.io is available and allowed.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Custom Commands**
- **Custom Actions**
- **Dataplane**
`,rbac:`# RBAC

RBAC views cover Service Accounts, Roles, Role Bindings, Cluster Roles, and
Cluster Role Bindings.

## What This View Is For

Use RBAC views to trace which subjects receive which permissions and whether
permissions are namespaced or cluster-wide.

## Resource Views

- **Service Accounts**: identities used by workloads.
- **Roles**: namespaced permission rules.
- **Role Bindings**: namespaced bindings between subjects and roles.
- **Cluster Roles**: cluster-scoped permission rules.
- **Cluster Role Bindings**: cluster-wide bindings between subjects and cluster
  roles.

## Common Workflows

- Open a Service Account and inspect related bindings.
- Open a Role Binding to see subjects and referenced role.
- Use Cluster Role and Cluster Role Binding views for cluster-wide access.
- Review YAML when the table summary is not enough to understand a rule.

## Permission And Data Notes

RBAC inspection depends on RBAC permissions too. If the active account cannot
list roles or bindings, kview shows access-denied states or partial related
sections.

## Related Settings

- **Resource Tags**
- **Actions And Safety**
`,"resource-drawers":`# Resource Drawers

Drawers are the primary inspection surface for individual resources. They open
from list rows while keeping the list context available behind them.

## What This View Is For

Use drawers to move from a row-level signal to detailed resource state, related
objects, events, metadata, YAML, and supported actions.

## Main Controls

- **Overview tab**: starts with actions and attention-worthy state, then shows
  key operational details.
- **Notes tab**: stores local operator notes and shows any saved investigation
  snapshots for the current context/resource.
- **Search and Activity**: saved investigation snapshots can appear in header
  search results and the Activity panel, linking back to their primary resource.
- **Attention banner**: shows resource signals in a consistent order: severity,
  optional local recurrence and saved-investigation state, reason, optional
  calculated detail, **Acknowledge signal**, and **Investigate signal**.
- **Relation tabs**: show resource-specific relationships such as pods,
  endpoints, owners, subjects, rules, volumes, or Helm objects.
- **Events tab**: shows Kubernetes events related to the resource when
  available.
- **Logs tab**: appears only for resources that stream logs directly. Today,
  pods own direct log streaming; workload drawers navigate to pods for logs.
- **Metadata tab**: shows labels, annotations, and summary metadata.
- **YAML tab**: shows the resource YAML and, for supported resources, guarded
  live patch controls.

## Optional Behavior

**Smart YAML collapse** is enabled by default. When enabled, YAML panels
collapse noisy sections such as managed fields and expose fold controls in code
blocks. When disabled, YAML renders without automatic folds.

**Resource Tags** are disabled by default. When enabled, supported drawer
headers show tag controls for the current resource. Namespace-scoped resources
can also show inherited namespace tags when **Inherit namespace tags** is on.

Drawer width is persisted locally from direct resize interaction and reused for
later drawers. It is not edited from the Settings form.

## Common Workflows

- Open a row with <kbd>Enter</kbd> or double-click.
- Start from **Overview** to understand attention reasons, conditions, warning
  events, and current state.
- Use **Acknowledge signal** when a signal is known but not fixed yet.
- Use **Investigate signal** to open a read-only evidence dialog with related
  events, YAML checks, log snippets when available, related signals, and a
  copyable Markdown debug bundle. Use **Save snapshot** in that dialog to store
  the generated investigation locally for later operator follow-up; this writes
  kview's local state only, not Kubernetes annotations or objects.
- When Attention shows **Previously resolved**, **Known**, **Watching**, or
  **Known noisy**, hover the state to review the latest matching snapshot note or
  select it to open that snapshot's primary resource.
- Use relation tabs to jump from one resource to another without returning to
  the list first.
- Use **Events** before mutating when a resource is failing or recently changed.
- Use **YAML** for exact Kubernetes state and guarded live patches when
  supported.

## Permission And Data Notes

Drawer content is permission-aware. Some tabs or sections may be missing,
empty, degraded, or access denied when the active account cannot read related
resources. Actions are shown only when capability checks allow them for the
current target.

## Related Settings

- **Smart YAML collapse**
- **Resource Tags**
- **Dataplane**
`,"resource-lists":`# Resource Lists

Resource lists are the main working surface for Kubernetes objects. They show
rows for the active context and, for namespaced resources, the active
namespace.

## What This View Is For

Use resource lists to scan many objects quickly, filter to a smaller set, open
drawers for detail, and start resource-specific actions when available.

## Main Controls

- **Text filter**: filters the current list using resource-specific fields such
  as name, namespace, status, labels, images, selectors, or related targets.
- **Quick filter chips**: generated chips that apply common text filters when
  Smart Filters produce matches.
- **Saved view**: opens a saved list or dashboard view. Resource list saved
  views restore the context, namespace, resource list, filter, sort order,
  visible columns, and column widths captured when the view was saved.
  Dashboard saved views restore dashboard signal filters, search, sort order,
  and rows per page. Saved views are global across dashboard and list pages, so
  choosing one can move you back to its saved dashboard, context, namespace, and
  resource list.
- **Focused navigation**: dashboard signals, namespace signals, and global
  search can open a matching resource list with a one-time text filter applied.
  This clears stale quick-filter chips and leaves saved-view mode unless you
  explicitly choose a saved view.
- **Save current view**: stores the current list layout and filter as a named
  local view. If a saved view is selected, saving updates that view. Use the
  delete button next to the selector to remove the selected saved view.
- **Refresh**: manually reloads the list. Some dataplane-backed lists also
  watch a cheap revision endpoint and reload only when cached data changes.
- **Column sorting**: sort by supported table columns.
- **Column resizing**: drag column separators to adjust widths. Manual widths
  are saved locally per context, resource view, and namespace.
- **Row selection**: click a row to select it, then press <kbd>Enter</kbd> or
  double-click to open its drawer.

## Optional Behavior

**Smart Filters** are enabled by default. When enabled, kview evaluates
configured Smart Filter rules against list rows. A chip appears only when the
generated label reaches **Minimum rows per chip**. When disabled, generated
chips are hidden and the text filter remains available.

**Resource Tags** are disabled by default. When enabled, supported lists show a
**Tags** column. The text filter also supports \`tag:<name>\` to match assigned
or inherited tags. When a row has more tags than the list cell shows, kview
adds a \`+N\` indicator; hover it to see the full tag list.

**Resource tag cleanup** is optional. When enabled, kview removes direct tag
assignments for non-namespace resources in a visible scope only after an
authoritative fresh list confirms that a resource no longer exists.

## Status Metadata

Many lists show dataplane metadata above the table. This can include freshness,
coverage, degradation, completeness, and state. Use this strip to understand
whether rows came from live reads, cached snapshots, partial visibility, or a
degraded fallback.

## Common Workflows

- Filter by a resource name, owner, image, status, or \`tag:<name>\`.
- Use generated chips to jump to a repeated naming pattern.
- Save a filtered or customized list when you frequently return to the same
  context, namespace, resource type, filter, sort order, or column layout.
- Select a saved view from any resource list to return to its saved location
  and table layout, or to jump back to a saved dashboard signal view.
- Resize dense columns when values are clipped.
- Hover tag overflow indicators when the Tags column has a \`+N\` marker.
- Open a row drawer to inspect status, events, metadata, and YAML.
- Use access-denied or degraded states to understand whether missing data is a
  permission issue or a partial-data issue.

## Saved View Drift

After opening a saved view, changing the text filter, sort order, visible
columns, or column widths makes the current table different from the saved
definition. kview keeps the saved view selected and shows a **Modified** marker
so you can see that the table has drifted.

When a saved view is marked **Modified**:

- Click **Save current view** to update the selected saved view with the current
  table state.
- Select the same saved view again to discard the local drift and restore the
  saved definition.
- Click the **Clear saved view** \`X\`, or select **No saved view**, to leave
  saved-view mode and reset the list filter, quick filter, sort order, visible
  columns, and saved-view-applied column widths.

Saved-view mode is explicit. kview enters it only when you select a saved view
or save a new one. It does not automatically select a saved view just because
the current table happens to match a saved definition.

Navigation rules:

- Selecting a saved view can move you to the dashboard, another context,
  namespace, or resource list.
- Navigating away from the saved view's context, namespace, or resource list
  leaves saved-view mode.
- Filtering, quick-filter chips, sorting, hiding columns, or resizing columns
  keeps the saved view selected and marks it **Modified** until you update,
  restore, or deselect it.

## Permission And Data Notes

List visibility follows Kubernetes RBAC. If the active account cannot list a
resource, kview shows an access-denied state for that view. If only some related
data is visible, kview prefers partial or degraded payloads over failing the
entire list.

Saved views are local browser settings. They do not grant access to resources;
opening a saved view still follows the current Kubernetes context and RBAC.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Dataplane**
`,"resource-macros-dynamic-links":`# Resource Macros And Dynamic Links

Resource Macros and Dynamic Links are local settings for building external
links from resource information. They are not Kubernetes labels or annotations.

## What This Is For

Use Resource Macros and Dynamic Links when resource names, labels, or
annotations contain values that map to external systems such as Jira, GitLab,
runbooks, dashboards, or internal portals.

## Main Controls

- **Enable resource macros**: allows kview to resolve manual and extracted
  macro values for resource drawers.
- **Enable dynamic links**: shows resolved external links in supported resource
  drawer headers.
- **Manual Macros tab**: define fixed values such as \`$JIRA_URL\` or
  \`$GITLAB_URL\`, optionally scoped to a context, namespace, node, or resource.
- **Extracted Macros tab**: derive values from a resource name, label, or
  annotation by using a regular expression and value template.
- **Dynamic Links tab**: define link labels and URL templates that use macros.
  Links are not scoped to resource types; they appear anywhere their template
  can be resolved.

Resource drawer headers include a macro edit control for assigning manual
macros to that drawer scope. The macro menu shows directly assigned macros
first and can optionally show inherited and extracted macros for the selected
resource. Dynamic links appear as chips in the same drawer header row as
resource tags when their URL templates resolve and the drawer has the resource
metadata needed by the link.

## Macro Resolution

Manual macros can be scoped from broad to narrow. Narrower scopes override
broader scopes when the same macro name is available.

The settings form offers known contexts, namespaces, and resource types as
selectors. Resource names and node names can be typed when a macro needs to
target one exact object.

When a macro is assigned from a drawer, kview fills the scope from the drawer:
namespace drawers create namespace-scoped macros, pod drawers create
pod-specific macros, and other supported resource drawers create resource-
scoped macros.

The resolution order is:

- global
- context
- namespace
- node
- extracted values from the selected resource
- resource

Macros can reference other macros. For example, \`$JIRA_ISSUE_URL\` can use
\`$JIRA_URL\` and \`$JIRA_ISSUE\`. kview resolves macro references recursively and
stops if a cycle or excessive depth is detected.

## Extracted Values

An extractor defines:

- the macro name to create
- optional resource types where it applies
- the source: resource name, label, or annotation
- a regular expression pattern
- a value template such as \`$1\`
- an optional transform: none, uppercase, lowercase, or uppercase first letter

If the extractor does not match the selected resource, the macro is not
created for that drawer.

## Dynamic Links

Dynamic links use URL templates such as:

\`\`\`text
$GITLAB_URL/$GITLAB_PROJECT/-/tree/$GITLAB_BRANCH
\`\`\`

A link appears only when all referenced macros resolve and the final URL uses
\`http\` or \`https\`.

## Permission And Data Notes

Resource Macros and Dynamic Links are stored in local kview settings. They do
not write to Kubernetes resources. Opening a dynamic link leaves kview and uses
the resolved external URL in the browser.

## Related Settings

- **Links & Macros**
- **Import / Export**
`,"resource-tags":`# Resource Tags

Resource Tags are local, personal labels stored in kview settings. They are not
Kubernetes labels or annotations.

## What This Is For

Use Resource Tags to mark resources for personal workflows, triage, ownership
notes, temporary investigations, or favourites that should not be written back
to the cluster.

## Main Controls

- **Enable resource tags**: shows tag columns in resource lists and tag
  controls in resource drawer headers.
- **Inherit namespace tags**: shows namespace tags on namespace-scoped
  resources.
- **Show tag quick filters**: adds tag chips to resource list quick filters
  when **Resource Tags** and **Smart Filters** are enabled.
- **Cleanup missing resource assignments**: when enabled, removes direct tag
  assignments for non-namespace resources only after an authoritative fresh
  list confirms the resource is gone.
- **Add tag**: creates a tag definition with name and color. Use the color
  picker on each tag to edit the hex value or choose a suggested color.
- **Auto-Tagging**: defines rules that assign existing tags from a resource
  name, label value, or annotation value without storing a direct assignment.
- **Tag assignment menu**: opens from supported drawer headers.
- **Dynamic link chips**: when Links & Macros are enabled and a link resolves,
  link chips appear next to tag chips in the drawer header.

## Optional Behavior

Resource Tags are disabled by default. When disabled, tag columns and drawer
tag controls are hidden. When enabled, resource lists show a **Tags** column
after the resource name column where possible, and list filtering can match
tags with \`tag:<name>\`. List cells show the first visible tags plus a \`+N\`
marker when additional tags are attached; hover the marker to see all tags for
that row.

When **Show tag quick filters** is enabled, visible list rows also produce
quick-filter chips for tags that are present in the current list. Selecting a
tag quick filter applies the same \`tag:<name>\` behavior as typing a tag filter.

When enabled, the cluster dashboard can also show tag chips in the signal
filters for tagged resources that have signals in the loaded signal set.

Namespace inheritance is enabled by default once Resource Tags are enabled. An
inherited tag appears on a namespaced resource because its namespace has that
tag. Removing the tag from the resource does not remove the namespace tag.

Auto-tagging rules are optional and live under the **Auto-Tagging** tab. A rule
can target any context or one selected context, any resource type or selected
resource types, and one source: \`name\`, \`label\`, or \`annotation\`. Label and
annotation rules can match a specific key or any value when the key is empty.
Patterns use regular expressions; invalid patterns are ignored until fixed.
Auto-tagged resources appear with the same tag chips and \`tag:<name>\` list
filter behavior as directly tagged resources.

Tag chips indicate where a tag came from. Direct tags use filled chips,
namespace-inherited tags use outlined chips, and auto-applied tags use a
spark icon with a dashed border. The drawer tag menu edits direct assignments
and shows auto-applied and inherited tags as read-only sections.

## Common Workflows

- Tag a namespace to make all related namespaced resources easier to spot.
- Tag a failing workload during an incident.
- Add an auto-tagging rule for labels such as \`app.kubernetes.io/part-of\` or
  names such as \`^prod-\`.
- Use \`tag:<name>\` in list filters to find tagged resources.
- Export settings to move tag definitions and assignments to another browser
  profile.

## Permission And Data Notes

Resource Tags are local kview data. They do not require Kubernetes write
permissions and are never sent as labels, annotations, or patches.

## Related Settings

- **Resource Tags**
- **Import / Export**
`,settings:`# Settings

kview settings are stored in the browser profile through localStorage. Settings
are auto-saved as soon as a control changes. There is no separate **Save**
button. Settings can be exported and imported as JSON.

## What This Is For

Settings control local kview preferences, optional UI behavior, custom operator
workflows, and dataplane policy. Settings are local to the browser profile
unless exported and imported elsewhere.

## Appearance And Workflow

Appearance settings currently include:

- **Check for kview updates**: optional and off by default. When enabled, kview
  checks the latest GitHub release while the app is open and shows an update
  notice in the sidebar when the running version is older.
- **Smart YAML collapse**: on by default. When enabled, YAML panels collapse
  noisy sections such as managed fields and expose fold controls in code blocks.
  Turning it off renders YAML without those automatic folds.
- **Smart namespace sorting**: optional and off by default. When enabled, the
  namespace selector prioritizes recently used favourites, then other
  favourites, recent namespaces, and finally the remaining namespaces. When
  disabled, namespaces use the normal alphabetical sort.
- **Combined dashboard signal filters**: optional and off by default. When
  disabled, selecting a dashboard signal chip replaces the current signal
  filter. When enabled, non-derived signal chips can be combined; kview sends
  the selected filters together and narrows the remaining chip choices to the
  matching signal set.
- **Dashboard favourite namespace filters**: optional and off by default. When
  enabled, the dashboard signal filters include chips for namespaces marked as
  favourites in the active context.
- **Dashboard recent namespace filters**: optional and off by default. When
  enabled, the dashboard signal filters include chips for recently visited
  namespaces in the active context.
- **Recent menu**: optional and off by default. When enabled, the side
  navigation shows a Recent group above the normal resource groups. The
  **Recent menu limit** setting controls how many recently opened resource
  sections appear there.

Performance Diagnostics is a separate settings section on the Appearance page.
It can collect browser long-task samples and capture a diagnostic JSON snapshot
when explicitly enabled.

Some UI preferences are still persisted locally even though they are not edited
from the Appearance form. For example, context and namespace selection,
collapsed sidebar groups, resource drawer width, and Activity Panel open state
and height are saved from direct interaction with those UI elements.

Saved resource views are also stored locally. They are created from resource
list toolbars and are included in full settings export/import.

## Profiles

Profiles are local snapshots of kview settings sections. Create a profile from
the current settings when you want to preserve a workflow setup, such as daily
monitoring, incident triage, or Helm review.

Profile snapshots include appearance, keyboard, smart filters, resource tags,
links and macros, saved views, custom commands, custom actions, and dataplane
settings. The profile library itself is not nested into snapshots.

Applying a profile replaces those captured settings sections and marks that
profile as active. Updating a profile overwrites its snapshot with the current
settings. Deleting a profile removes only that local snapshot.

## Keyboard

Keyboard settings control optional bindings:

- **Vim-style table navigation**: on by default. Adds <kbd>h/j/k/l</kbd>
  table cell movement in addition to arrow keys.
- **Home-row table navigation**: on by default. Adds <kbd>a/s/d/f</kbd>
  table cell movement in addition to arrow keys.
- **Single-letter global search**: on by default. Adds <kbd>s</kbd> as a
  shortcut for focusing the header search and command input.
  <kbd>Ctrl+K</kbd> remains available regardless of this setting.

Press <kbd>?</kbd> in the app to see the effective shortcuts after optional
bindings are applied.

## Smart Filters

Smart filters are optional quick-filter chips generated from list rows. They
are enabled by default, but only appear when configured rules match enough rows
to meet **Minimum rows per chip**.

Rules are evaluated in order. Each row stops at the first matching rule, so
more specific rules should be placed above broader rules. A rule can be scoped
by context, namespace, and resource type when it should not apply globally.

When smart filters are disabled, resource lists still support normal text
filtering, but generated quick-filter chips are hidden.

## Resource Tags

Resource tags are optional and off by default. They are stored only in kview
settings; they are never written to Kubernetes resources.

When **Enable resource tags** is on, supported resource lists show a Tags
column and supported drawer headers show tag controls. Tags can be assigned to
individual resources.

When **Show tag quick filters** is on, resource list quick filters include tag
chips from visible rows when both **Resource Tags** and **Smart Filters** are
enabled.

When **Inherit namespace tags** is on, namespace-scoped resources also show tags
assigned to their namespace. Inherited tags are shown differently from direct
resource tags and do not create Kubernetes labels or annotations.

Use the **Auto-Tagging** tab to assign existing tags automatically from resource
names, label values, or annotation values. Auto-applied tags are shown
differently from direct and namespace-inherited tags, and they do not change
the direct tag assignment menu state.

When **Cleanup missing resource assignments** is on, a fresh list that confirms
a resource is gone removes direct tag assignments in that visible scope.

## Links And Macros

Links & Macros are optional and off by default. They are stored only in kview
settings.

When **Enable resource macros** is on, kview can resolve manual macros and
macros extracted from supported resource drawer data. Manual macros can be
scoped globally or to a context, namespace, node, or resource. Extracted macros
can read a resource name, label, or annotation with a regular expression.

When **Enable dynamic links** is on, supported resource drawers show links
whose URL templates resolve completely. Links with missing macros are hidden.
Rendered links appear in the drawer header under the title, next to any tag
summary.
In drawer headers that support local resource tags, the macro edit control can
assign manual macros to the current namespace, pod, or resource without typing
the scope by hand. The same menu can show inherited and extracted macros when
that extra context is needed.

## Custom Commands

Custom commands run against matching pod containers. Define the command, output
format, target matching rules, and safety level.

## Custom Actions

Custom actions apply configured workload changes such as setting environment
variables, unsetting environment variables, changing images, or applying JSON
or merge patches.

## Dataplane

Dataplane settings control snapshots, cache persistence, observers, namespace
enrichment, all-context enrichment, background concurrency, metrics, and signal
thresholds. Use profile presets first, then tune individual values only when
the cluster size or permissions require it.

Signal display priority is controlled by moving signal cards up or down in the
Signal Catalog. Higher cards are considered earlier when signals have similar
severity and freshness.

## Permission And Data Notes

Most settings only change local UI behavior. Dataplane settings can change how
aggressively kview reads cluster data in the active context. Custom Commands and
Custom Actions can trigger Kubernetes API calls or container exec sessions only
when the selected resource and RBAC permissions allow them.
`,"smart-filters":`# Smart Filters

Smart Filters generate quick-filter chips for resource lists from configurable
name-matching rules.

## What This Is For

Use Smart Filters when many resources share naming patterns and you want one
click filters for repeated groups such as teams, apps, environments, or
release prefixes.

## Main Controls

- **Enable smart filters**: turns generated list chips on or off.
- **Minimum rows per chip**: controls how many matching rows are required
  before kview shows a chip.
- **Rules**: define matching pattern, display label, scope, and enabled state.
- **Rule order**: rules are evaluated top to bottom; each row stops at the
  first matching rule.

## Optional Behavior

Smart Filters are enabled by default. When enabled, kview evaluates configured
rules against the current list rows and shows chips only for labels with enough
matches. If **Resource Tags** and **Show tag quick filters** are also enabled,
visible list tags are added as quick-filter chips. When Smart Filters are
disabled, generated quick-filter chips are hidden but the normal text filter
continues to work.

Rules can be scoped by context, namespace, resource type, or all resources. Use
scope when a naming pattern is meaningful in one cluster or namespace but noisy
elsewhere.

## Common Workflows

- Create specific rules before broad rules.
- Use a display label that matches how you talk about the group.
- Raise **Minimum rows per chip** when too many chips appear.
- Disable a rule temporarily instead of deleting it while tuning.

## Permission And Data Notes

Smart Filters only operate on rows already visible in the current list. They do
not read extra Kubernetes data and do not change cluster state.

## Related Settings

- **Smart Filters**
- **Resource Lists**
`,storage:`# Storage

Storage views cover Persistent Volume Claims and Persistent Volumes.

## What This View Is For

Use Storage views to inspect binding state, storage class, capacity, related
workloads, and low-confidence unused-resource signals.

## Persistent Volume Claims

PVC views are namespaced. They show claim phase, requested capacity, storage
class, bound volume, age, events, metadata, YAML, and related workload usage
when visible.

## Persistent Volumes

PV views are cluster-scoped. They show phase, capacity, storage class, reclaim
policy, claim reference, events, metadata, and YAML.

## Common Workflows

- Start from Dashboard PVC signals when looking for potentially unused storage.
- Open a PVC and inspect related workloads before deleting anything.
- Check events and YAML when a claim is pending or a volume is released.
- Use tags for local investigation state.

## Permission And Data Notes

Unused-storage signals are intentionally low confidence. Confirm workload
usage, claim state, events, and ownership before taking destructive action.

## Related Settings

- **Dashboard And Signals**
- **Resource Tags**
- **Dataplane**
`,troubleshooting:`# Troubleshooting

Use this page when kview starts but cannot show expected cluster data, actions,
metrics, or cached state.

## No Contexts Found

kview did not find a usable Kubernetes context. Confirm that the shell running
kview has the expected kubeconfig and that \`kubectl config get-contexts\` works
from the same environment.

kview checks \`--config\` first, then \`KUBECONFIG\`, then the default path
\`~/.kube/config\`. If \`--config\` or \`KUBECONFIG\` points at a directory, kview
loads files directly inside that directory in name order and skips nested
directories. If you store kubeconfigs in nested folders, pass each file or
directory explicitly with the platform path-list separator, such as \`:\` on
Linux and macOS or \`;\` on Windows.

The startup dialog lists the readable files kview actually tried to load. Use
that list to catch typos, missing mounted files, unexpected environment
variables, or a process launched from a different shell than the one where
\`kubectl\` works.

## Authentication Fails

If your kubeconfig uses an exec auth plugin, install the referenced command and
make sure it is available on \`PATH\`. Cloud-provider CLIs and kubelogin tools
must be available to the kview process.

kview passes the effective kubeconfig file list to exec auth plugins through
\`KUBECONFIG\` unless the plugin environment already defines \`KUBECONFIG\`.

## Access Denied

Access denied states usually mean your Kubernetes account lacks permission for
that resource. kview continues showing other resources where access is allowed.

## Data Looks Partial

Some views use cached snapshots and degraded payloads so useful data remains
visible even when direct reads are limited. Check freshness, coverage, and
degradation metadata on list pages and dashboard panels.

## Metrics Are Missing

Metrics require metrics.k8s.io to be installed and allowed by RBAC. If metrics
are unavailable, kview hides usage widgets instead of failing the view.

## Local Cache Issues

Dataplane persistence is optional. If cache migration fails or stale data is
confusing, disable persistence in Settings or clear the local cache file outside
of kview.

## Related Settings

- **Check for kview updates**
- **Dataplane**
- **Metrics**
- **Resource Tags**
- **Import / Export**
`,"views-and-resources":`# Views And Resources

kview covers common Kubernetes resources and related operator workflows.

## What This Is For

Resource views provide list-first navigation into Kubernetes objects, related
resources, signals, events, metadata, and YAML.

## Dashboard

Dashboard summarizes cluster and namespace health. It shows totals, workload
state, namespace snapshots, node summaries, and attention signals.

Signals are designed for triage. They include severity, likely cause, suggested
action, and quick-filter keys when available.

Dashboard signal filtering has optional behavior controlled by Settings:

- By default, selecting a signal chip replaces the active filter.
- With **Combined dashboard signal filters** enabled, non-derived signal chips
  can be selected together. kview requests the selected filters as one combined
  signal query and narrows the remaining chip choices to matching signals.
- With **Dashboard favourite namespace filters** enabled, the dashboard includes
  signal chips for favourited namespaces in the active context.
- With **Dashboard recent namespace filters** enabled, the dashboard includes
  signal chips for recently visited namespaces in the active context.

Dashboard refresh cadence is configured in Dataplane settings, not in the
Appearance section. Wide and diagnostic dataplane profiles apply a minimum
refresh floor so broad dashboard refreshes do not run too aggressively.

## Workloads

Workload views include Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets,
Jobs, CronJobs, and Horizontal Pod Autoscalers.

Use these views to inspect readiness, age, images, restarts, conditions,
related resources, logs where supported, and YAML.

## Networking

Networking views include Services and Ingresses. They focus on selectors,
endpoints, backend readiness, hosts, TLS, and related pods or workloads.

## Policy

Policy views include Network Policies, ResourceQuotas, and LimitRanges. They
show namespace traffic policy, resource quota usage, default/min/max limits,
and the selectors or rules that influence workload admission and connectivity.

## Configuration

Configuration views include ConfigMaps and Secrets. kview surfaces metadata,
usage signals where available, and YAML. Secret values are handled cautiously
and are not treated as normal display text.

## Access Control

Access control views include Service Accounts, Roles, Role Bindings, Cluster
Roles, and Cluster Role Bindings. These views help trace subjects, rules, and
bindings across namespaced and cluster-scoped RBAC.

## Storage

Storage views include Persistent Volume Claims and Persistent Volumes. They show
phase, capacity, storage class, binding state, related workloads, and attention
signals for low-confidence unused resources.

## Helm

Helm views include releases and chart catalog rows derived from cached cluster
state. Release actions are capability-aware and use the same guarded mutation
flow as Kubernetes resource actions.

## Extensions

Extension views include Custom Resource Definitions, namespaced custom
resources, and cluster-scoped custom resources. These views help discover and
inspect CRDs without requiring kview-specific code for each custom kind.

## Permission And Data Notes

Resource visibility follows the active Kubernetes context and RBAC permissions.
When kview cannot read a resource directly, it may still show derived or cached
data if the dataplane already has enough visible snapshots to build a useful
view. List metadata describes freshness, coverage, degradation, and completeness
when that information is available.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Smart Filters**
- **Dashboard signal filter options**
`,"whats-new":`# What's New

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
- \`kview --version\` and \`kview -version\` now print the resolved build version
  without starting the application.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
`,workflows:`# Common Workflows

This page collects practical paths through kview for common operator tasks.

## Investigate A Failing Pod

- Open **Dashboard** and select a pod or workload signal.
- Navigate to the pod or workload drawer.
- Review **Overview**, conditions, warning events, and restart information.
- Open **Logs** on the pod drawer when available.
- Check YAML only after reviewing higher-level state.

## Trace Ingress To Pods

- Open **Ingresses** and select the relevant Ingress.
- Review hosts, TLS, rules, and backend services.
- Open the related Service.
- Check selectors and endpoint readiness.
- Navigate to related pods for logs or conditions.

## Review Potentially Unused Storage

- Start from Dashboard PVC signals or the PVC list.
- Open the PVC drawer and review phase, age, bound volume, events, and related
  workloads.
- Confirm ownership from labels, annotations, and YAML before deleting.

## Use Tags During An Incident

- Enable **Resource Tags**.
- Create a temporary tag such as \`incident\` or \`watch\`.
- Assign it to namespaces or resources under investigation.
- Use \`tag:<name>\` filters to return to the same set quickly.
- Export settings if the tag set needs to move to another browser profile.

## Safely Apply A Change

- Open the resource drawer.
- Review **Overview**, events, and YAML.
- Use a guarded action or YAML edit flow only when the current state matches
  the intended target.
- Confirm warnings and typed confirmations before applying.
- Watch the Activity Panel and refresh the related list or drawer after the
  change.

## Permission And Data Notes

Workflows are limited by the active context and Kubernetes RBAC. If kview shows
partial data, use metadata strips, access-denied states, and drawer warnings to
understand what is visible before acting.
`},N=j,P=N.pages.filter(e=>e.surfaces.includes(`app`)).map(e=>({...e,body:M[e.id]||``})),F=N.featuredPages.map(e=>P.find(t=>t.id===e)).filter(e=>!!e);function I(e){let t=[];for(let n of e){let e=t.find(e=>e.category===n.category);e||(e={category:n.category,pages:[]},t.push(e)),e.pages.push(n)}return t}var L=`https://github.com/korex-labs/kview/blob/main/CHANGELOG.md`,R=10;function z(e,t){if(!t)return!0;let n=t.toLowerCase();return`${e.title} ${e.category} ${e.body}`.toLowerCase().includes(n)}function B(e){let t=e.body.replace(/\r\n/g,`
`).split(`
`);return t[0]?.trim().toLowerCase()===`# ${e.title.toLowerCase()}`?t.slice(1).join(`
`).trimStart():e.body}function V(e){let t=e.replace(/\r\n/g,`
`).split(`
`),n=[],r=!1,i=0,a=!1;for(let e of t){if(/^##\s+Recent Highlights\s*$/.test(e)){r=!0,n.push(e);continue}if(r&&/^##\s+/.test(e)){r=!1,n.push(e);continue}if(!r){n.push(e);continue}if(/^-\s+/.test(e)){i+=1,a=i<=R,a&&n.push(e);continue}if(/^\s{2,}\S/.test(e)){a&&n.push(e);continue}n.push(e)}return n.join(`
`)}function H(e){let t=B(e);return e.id===`whats-new`?V(t):t}var U={flex:1,minHeight:0,display:`flex`,overflow:`hidden`,backgroundColor:`var(--bg-primary)`},W={flex:1,minWidth:0,overflow:`auto`,p:1.25,backgroundColor:`background.paper`,backgroundImage:e=>e.palette.mode===`dark`?`linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))`:`none`,"& .MuiPaper-root":{backgroundColor:`background.paper`,backgroundImage:e=>e.palette.mode===`dark`?`linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))`:`none`}};function G({onClose:e}){let[o,s]=(0,E.useState)(``),[y,x]=(0,E.useState)(F[0]?.id||P[0]?.id||``),O=(0,E.useMemo)(()=>P.filter(e=>z(e,o.trim())),[o]),k=(0,E.useMemo)(()=>I(O),[O]),j=P.find(e=>e.id===y)||O[0]||P[0],M=N.externalLinks,R=[M.github?{id:`github`,label:`GitHub`,href:M.github,icon:(0,D.jsx)(g,{fontSize:`small`})}:null,M.website?{id:`website`,label:`Website`,href:M.website,icon:(0,D.jsx)(p,{fontSize:`small`})}:null,M.patreon?{id:`patreon`,label:`Patreon`,href:M.patreon,icon:(0,D.jsx)(_,{fontSize:`small`})}:null].filter(e=>!!e);return b((0,E.useMemo)(()=>({id:`help-view`,label:`Help`,kind:`dialog`,suppressGlobalShortcuts:!0,suppressContextShortcuts:!0,onEscape:e}),[e])),(0,D.jsxs)(f,{"data-testid":`help-view`,sx:U,children:[(0,D.jsxs)(t,{variant:`outlined`,sx:S,children:[(0,D.jsx)(r,{variant:`overline`,color:`text.secondary`,sx:{display:`block`,mb:.25},children:`Help`}),(0,D.jsx)(c,{size:`small`,label:`Search help`,value:o,onChange:e=>s(e.target.value),sx:{my:1}}),(0,D.jsx)(i,{sx:{mb:1}}),(0,D.jsx)(f,{children:k.map(e=>(0,D.jsxs)(f,{sx:{mb:1},children:[(0,D.jsx)(r,{variant:`overline`,color:`text.secondary`,children:e.category}),(0,D.jsx)(n,{dense:!0,disablePadding:!0,children:e.pages.map(e=>(0,D.jsxs)(u,{selected:j?.id===e.id,onClick:()=>x(e.id),sx:w,children:[(0,D.jsx)(a,{sx:C(j?.id===e.id),children:(0,D.jsx)(h,{fontSize:`small`})}),(0,D.jsx)(l,{primary:e.title,slotProps:{primary:{variant:`body2`}},sx:T})]},e.id))})]},e.category))}),R.length?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsx)(i,{sx:{my:1}}),(0,D.jsx)(r,{variant:`overline`,color:`text.secondary`,children:`Project`}),(0,D.jsx)(n,{dense:!0,disablePadding:!0,children:R.map(e=>(0,D.jsxs)(u,{component:`a`,href:e.href,target:`_blank`,rel:`noreferrer`,sx:w,children:[(0,D.jsx)(a,{sx:C(!1),children:e.icon}),(0,D.jsx)(l,{primary:e.label,slotProps:{primary:{variant:`body2`}},sx:T})]},e.id))})]}):null]}),(0,D.jsxs)(f,{sx:W,children:[(0,D.jsx)(f,{sx:{display:`flex`,justifyContent:`flex-end`,mb:1.25},children:(0,D.jsx)(v,{tooltip:`Close help`,label:`Close help`,onClick:e,children:(0,D.jsx)(m,{fontSize:`small`})})}),(0,D.jsx)(t,{variant:`outlined`,sx:{maxWidth:900,p:1.5},children:j?(0,D.jsxs)(D.Fragment,{children:[(0,D.jsxs)(f,{sx:{display:`flex`,alignItems:`center`,gap:.5,minHeight:36},children:[(0,D.jsx)(f,{sx:{display:`flex`,color:`primary.main`,mr:.25},children:(0,D.jsx)(h,{fontSize:`small`})}),(0,D.jsx)(r,{variant:`subtitle2`,component:`h1`,sx:{fontWeight:600},children:j.title}),j.id===`whats-new`?(0,D.jsx)(d,{href:L,target:`_blank`,rel:`noreferrer`,variant:`body2`,sx:{ml:`auto`},children:`Full changelog`}):null]}),(0,D.jsx)(i,{sx:{mb:1}}),(0,D.jsx)(A,{markdown:H(j)})]}):(0,D.jsx)(r,{variant:`body2`,color:`text.secondary`,children:`No help pages matched the current search.`})})]})]})}export{G as default,V as limitWhatsNewHighlights};