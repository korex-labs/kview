import{r as e}from"./rolldown-runtime-S-ySWqyJ.js";import{C as t,G as n,N as r,Q as i,T as a,on as o,tn as s,u as c,w as l}from"./mui-grid-vendor-CjVCKpWG.js";import{d as u,f as d,y as f}from"./mui-vendor-D8gzlY93.js";import{_ as p,it as m,ut as h,v as g,y as _}from"./mui-icons-vendor-D5T_pl_9.js";import{a as v,i as y,l as b,o as x,s as S}from"./one-light-Cdc6ZjP8.js";import{n as C,w}from"./index-DDtLbGTC.js";var T=e(o(),1),E=s();function D(e){let t=[],n=e.replace(/\r\n/g,`
`).split(`
`),r=[],i=[],a=null,o=``,s=()=>{r.length&&(t.push({type:`paragraph`,text:r.join(` `)}),r=[])},c=()=>{i.length&&(t.push({type:`list`,items:i}),i=[])};for(let e of n){let n=e.match(/^```([a-zA-Z0-9_-]*)\s*$/);if(n){a?(t.push({type:`code`,language:o||`text`,code:a.join(`
`)}),a=null,o=``):(s(),c(),a=[],o=n[1]||`text`);continue}if(a){a.push(e);continue}if(!e.trim()){s(),c();continue}let l=e.match(/^(#{1,3})\s+(.+)$/);if(l){s(),c(),t.push({type:`heading`,level:l[1].length,text:l[2]});continue}let u=e.match(/^-\s+(.+)$/);if(u){s(),i.push(u[1]);continue}if(/^\s{2,}\S/.test(e)&&i.length>0){i[i.length-1]=`${i[i.length-1]} ${e.trim()}`;continue}c(),r.push(e.trim())}return a&&t.push({type:`code`,language:o||`text`,code:a.join(`
`)}),s(),c(),t}function O(e){let t=[],n=/(<kbd>.*?<\/kbd>|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g,r=0,i;for(;i=n.exec(e);){i.index>r&&t.push(e.slice(r,i.index));let n=i[0];if(n.startsWith(`<kbd>`))t.push((0,E.jsx)(C,{label:n.replace(/^<kbd>/,``).replace(/<\/kbd>$/,``)},`${i.index}-kbd`));else if(n.startsWith(`**`))t.push((0,E.jsx)(f,{component:`strong`,sx:{fontWeight:700},children:n.slice(2,-2)},`${i.index}-bold`));else if(n.startsWith("`"))t.push((0,E.jsx)(f,{component:`code`,sx:{px:.5,py:.125,borderRadius:.75,bgcolor:`action.hover`,fontFamily:`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,fontSize:`0.86em`},children:n.slice(1,-1)},`${i.index}-code`));else{let e=n.match(/^\[([^\]]+)\]\(([^)]+)\)$/);e&&t.push((0,E.jsx)(d,{href:e[2],target:`_blank`,rel:`noreferrer`,children:e[1]},`${i.index}-link`))}r=i.index+n.length}return r<e.length&&t.push(e.slice(r)),t}function k({markdown:e}){return(0,E.jsx)(f,{sx:{display:`flex`,flexDirection:`column`,gap:1.25},children:D(e).map((e,t)=>e.type===`heading`?(0,E.jsx)(n,{variant:e.level===1?`h5`:e.level===2?`h6`:`subtitle1`,component:e.level===1?`h1`:e.level===2?`h2`:`h3`,sx:{mt:t===0?0:1.25,fontWeight:700},children:e.text},`heading-${t}`):e.type===`list`?(0,E.jsx)(f,{component:`ul`,sx:{m:0,pl:2.5,display:`flex`,flexDirection:`column`,gap:.5},children:e.items.map((e,t)=>(0,E.jsx)(f,{component:`li`,sx:{pl:.25},children:(0,E.jsx)(n,{variant:`body2`,children:O(e)})},`${e}-${t}`))},`list-${t}`):e.type===`code`?(0,E.jsx)(w,{code:e.code,language:e.language,showCopy:!1},`code-${t}`):(0,E.jsx)(n,{variant:`body2`,color:`text.primary`,children:O(e.text)},`paragraph-${t}`))})}var A={version:1,title:`kview Help`,externalLinks:{github:`https://github.com/korex-labs/kview`,website:`https://korex-labs.com`,patreon:`https://www.patreon.com/cw/KorexLabs`},pages:[{id:`getting-started`,title:`Getting Started`,category:`Basics`,source:`getting-started.md`,surfaces:[`app`,`repo`,`website`]},{id:`navigation`,title:`Navigation`,category:`Basics`,source:`navigation.md`,surfaces:[`app`,`repo`,`website`]},{id:`views-and-resources`,title:`Views And Resources`,category:`Resources`,source:`views-and-resources.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-lists`,title:`Resource Lists`,category:`Resources`,source:`resource-lists.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-drawers`,title:`Resource Drawers`,category:`Resources`,source:`resource-drawers.md`,surfaces:[`app`,`repo`,`website`]},{id:`dashboard-and-signals`,title:`Dashboard And Signals`,category:`Resources`,source:`dashboard-and-signals.md`,surfaces:[`app`,`repo`,`website`]},{id:`actions-and-safety`,title:`Actions And Safety`,category:`Workflows`,source:`actions-and-safety.md`,surfaces:[`app`,`repo`,`website`]},{id:`workflows`,title:`Common Workflows`,category:`Workflows`,source:`workflows.md`,surfaces:[`app`,`repo`,`website`]},{id:`activity-panel`,title:`Activity Panel`,category:`Workflows`,source:`activity-panel.md`,surfaces:[`app`,`repo`,`website`]},{id:`pods-workloads`,title:`Pods And Workloads`,category:`Resources`,source:`pods-workloads.md`,surfaces:[`app`,`repo`,`website`]},{id:`networking`,title:`Networking`,category:`Resources`,source:`networking.md`,surfaces:[`app`,`repo`,`website`]},{id:`namespaces`,title:`Namespaces`,category:`Resources`,source:`namespaces.md`,surfaces:[`app`,`repo`,`website`]},{id:`helm`,title:`Helm`,category:`Resources`,source:`helm.md`,surfaces:[`app`,`repo`,`website`]},{id:`rbac`,title:`RBAC`,category:`Resources`,source:`rbac.md`,surfaces:[`app`,`repo`,`website`]},{id:`storage`,title:`Storage`,category:`Resources`,source:`storage.md`,surfaces:[`app`,`repo`,`website`]},{id:`custom-resources`,title:`Custom Resources`,category:`Resources`,source:`custom-resources.md`,surfaces:[`app`,`repo`,`website`]},{id:`settings`,title:`Settings`,category:`Configuration`,source:`settings.md`,surfaces:[`app`,`repo`,`website`]},{id:`smart-filters`,title:`Smart Filters`,category:`Configuration`,source:`smart-filters.md`,surfaces:[`app`,`repo`,`website`]},{id:`resource-tags`,title:`Resource Tags`,category:`Configuration`,source:`resource-tags.md`,surfaces:[`app`,`repo`,`website`]},{id:`custom-commands-actions`,title:`Custom Commands And Actions`,category:`Configuration`,source:`custom-commands-actions.md`,surfaces:[`app`,`repo`,`website`]},{id:`dataplane-settings`,title:`Dataplane Settings`,category:`Configuration`,source:`dataplane-settings.md`,surfaces:[`app`,`repo`,`website`]},{id:`import-export`,title:`Import / Export`,category:`Configuration`,source:`import-export.md`,surfaces:[`app`,`repo`,`website`]},{id:`troubleshooting`,title:`Troubleshooting`,category:`Support`,source:`troubleshooting.md`,surfaces:[`app`,`repo`,`website`]},{id:`whats-new`,title:`What's New`,category:`Updates`,source:`whats-new.md`,surfaces:[`app`,`repo`,`website`]}],featuredPages:[`getting-started`,`dashboard-and-signals`,`workflows`,`actions-and-safety`,`whats-new`]},j={"actions-and-safety":`# Actions And Safety

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

## YAML Editing

Supported resources can be edited from the YAML tab. The edit flow keeps the
resource identity fixed, validates before applying, warns about risky fields,
and uses confirmation before live apply.

If Kubernetes rejects the update because the resource changed, reload the YAML,
review the diff, and apply again only after confirming the new state.

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

## Common Workflows

- Open CRDs to understand available custom kinds.
- Use namespace or cluster custom resource views to inspect instances.
- Filter by kind, name, namespace, or tag.
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

- **Signal chips**: filter the signals table by priority, severity,
  acknowledgement state, kind, signal reason, namespace, or derived signal
  source.
- **Signal search**: narrows visible signals by text.
- **Signal sorting**: changes signal order by priority, severity, resource, or
  seen timestamps.
- **Signal acknowledgement**: marks a signal as known without treating it as
  resolved.
- **Inspect actions**: open the relevant resource drawer or navigate to a
  related list when kview can map the signal to a target.

## Optional Behavior

By default, selecting a signal chip replaces the active filter.

When **Combined dashboard signal filters** is enabled, non-derived signal chips
can be selected together. kview sends the selected filters as one combined
signal query and narrows the remaining chip choices to the matching signal set.

When **Dashboard favourite namespace filters** is enabled, the dashboard
includes signal chips for namespaces marked as favourites in the active context.

When **Dashboard recent namespace filters** is enabled, the dashboard includes
signal chips for recently visited namespaces in the active context.

Dashboard refresh cadence is configured under **Dataplane**. Wide and
diagnostic dataplane profiles apply a minimum refresh floor so broad dashboard
refreshes do not run too aggressively.

## Signals

Signals are backend-produced and designed for triage. A signal can include:

- severity
- resource kind and resource identity
- namespace or scope
- likely cause
- suggested action
- calculated details
- first seen and last seen timestamps
- acknowledgement state

Signals are heuristics over visible data. They are useful for prioritization,
but should be confirmed from resource details, events, logs, and YAML before
making risky changes.

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
- **Dataplane**
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
`,"getting-started":`# Getting Started

kview is a local Kubernetes UI for fast cluster exploration. It reads your
kubeconfig, starts a local server, and opens the UI in a browser or desktop
webview depending on how the binary was built.

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
across visible namespaces.

## Optional Behavior

Helm chart catalog data depends on dataplane snapshots. It may be stale,
partial, or unavailable when release secrets are not visible.

## Common Workflows

- Filter releases by chart, namespace, status, or tag.
- Open a stale or failed release from Dashboard signals.
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

Exportable sections include Smart Filters, Resource Tags, Custom Commands,
Custom Actions, Dataplane settings, favourite namespaces, recent namespaces,
and signal acknowledgements when available.

When importing a transfer bundle, kview detects the bundle and opens a review
dialog. The dialog shows the available sections, lets you choose which sections
to import, and applies the selected merge strategy.

## Merge Strategies

Merge strategies decide how imported sections interact with local settings:

- **Use imported**: replace matching local data with the imported data.
- **Keep mine**: keep local data when both profiles contain the same item.
- **Merge**: combine compatible data where possible.

Use **Use imported** when you trust the source profile and want to match it.
Use **Keep mine** when you are trying a shared bundle without overwriting local
customizations. Use **Merge** when both profiles contain useful definitions.

## Full Profile Backup

Full profile export writes the complete kview user settings profile. This is
useful for backup and restore, but it is broader than a transfer bundle. A full
profile import replaces the current settings profile after confirmation.

## Common Workflows

- Export a transfer bundle with only **Custom Commands** and **Custom Actions**
  to share operator workflows without changing someone else's UI preferences.
- Export **Resource Tags** and favourites when moving investigation context to
  another browser profile.
- Export a full profile before testing broad Dataplane or signal changes.
- Review transfer bundle sections before importing and select only the parts
  you expect to change.

## Permission And Data Notes

Import / Export changes local kview settings only. It does not write to
Kubernetes resources. Imported Custom Commands and Custom Actions can later
trigger Kubernetes API calls or container exec sessions only when a user runs
them and RBAC allows the operation.

## Related Settings

- **Smart Filters**
- **Resource Tags**
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
  sessions, port forwards, dataplane snapshots, namespace enrichment, runtime
  logs, and connectivity events.
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

Use global search to find resources from cached dataplane snapshots. Keyboard
command mode can jump to resources, namespaces, contexts, and settings.

Press <kbd>?</kbd> in the app to show keyboard shortcuts. Some shortcuts are
optional: Settings can disable single-letter global search (<kbd>s</kbd>) and
the extra <kbd>h/j/k/l</kbd> or <kbd>a/s/d/f</kbd> table navigation bindings.
Arrow-key table navigation and <kbd>Ctrl+K</kbd> global search remain
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
from the selected CronJob's job template.

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

- Open **Dashboard** signals for pod restarts or workload availability.
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
debug run requires permission to stop or delete the generated Job. Metrics
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
- **Relation tabs**: show resource-specific relationships such as pods,
  endpoints, owners, subjects, rules, volumes, or Helm objects.
- **Events tab**: shows Kubernetes events related to the resource when
  available.
- **Logs tab**: appears only for resources that stream logs directly. Today,
  pods own direct log streaming; workload drawers navigate to pods for logs.
- **Metadata tab**: shows labels, annotations, and summary metadata.
- **YAML tab**: shows the resource YAML and, for supported resources, guarded
  live edit controls.

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
- Use relation tabs to jump from one resource to another without returning to
  the list first.
- Use **Events** before mutating when a resource is failing or recently changed.
- Use **YAML** for exact Kubernetes state and guarded live edits when supported.

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
- **Refresh**: manually reloads the list. Some dataplane-backed lists also
  watch a cheap revision endpoint and reload only when cached data changes.
- **Column sorting**: sort by supported table columns.
- **Column resizing**: drag column separators to adjust widths. Manual widths
  stay stable while the list rerenders.
- **Row selection**: click a row to select it, then press <kbd>Enter</kbd> or
  double-click to open its drawer.

## Optional Behavior

**Smart Filters** are enabled by default. When enabled, kview evaluates
configured Smart Filter rules against list rows. A chip appears only when the
generated label reaches **Minimum rows per chip**. When disabled, generated
chips are hidden and the text filter remains available.

**Resource Tags** are disabled by default. When enabled, supported lists show a
**Tags** column. The text filter also supports \`tag:<name>\` to match assigned
or inherited tags.

**Resource tag cleanup** is optional. When enabled, kview removes direct tag
assignments in a visible scope after a fresh list confirms that a resource no
longer exists.

## Status Metadata

Many lists show dataplane metadata above the table. This can include freshness,
coverage, degradation, completeness, and state. Use this strip to understand
whether rows came from live reads, cached snapshots, partial visibility, or a
degraded fallback.

## Common Workflows

- Filter by a resource name, owner, image, status, or \`tag:<name>\`.
- Use generated chips to jump to a repeated naming pattern.
- Resize dense columns when values are clipped.
- Open a row drawer to inspect status, events, metadata, and YAML.
- Use access-denied or degraded states to understand whether missing data is a
  permission issue or a partial-data issue.

## Permission And Data Notes

List visibility follows Kubernetes RBAC. If the active account cannot list a
resource, kview shows an access-denied state for that view. If only some related
data is visible, kview prefers partial or degraded payloads over failing the
entire list.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Dataplane**
`,"resource-tags":`# Resource Tags

Resource Tags are local, personal labels stored in kview settings. They are not
Kubernetes labels or annotations.

## What This Is For

Use Resource Tags to mark resources for personal workflows, triage, ownership
notes, temporary investigations, or favourites that should not be written back
to the cluster.

## Main Controls

- **Enable resource tags**: shows tag columns in supported resource lists and
  tag controls in supported drawer headers.
- **Inherit namespace tags**: shows namespace tags on namespace-scoped
  resources.
- **Cleanup missing resource assignments**: removes direct tag assignments in a
  visible scope after a fresh list confirms the resource is gone.
- **Add tag**: creates a tag definition with name and color.
- **Tag assignment menu**: opens from supported drawer headers.

## Optional Behavior

Resource Tags are disabled by default. When disabled, tag columns and drawer
tag controls are hidden. When enabled, supported lists show a **Tags** column
and list filtering can match tags with \`tag:<name>\`.

Namespace inheritance is enabled by default once Resource Tags are enabled. An
inherited tag appears on a namespaced resource because its namespace has that
tag. Removing the tag from the resource does not remove the namespace tag.

## Common Workflows

- Tag a namespace to make all related namespaced resources easier to spot.
- Tag a failing workload during an incident.
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

## Keyboard

Keyboard settings control optional bindings:

- **Vim-style table navigation**: on by default. Adds <kbd>h/j/k/l</kbd>
  table cell movement in addition to arrow keys.
- **Home-row table navigation**: on by default. Adds <kbd>a/s/d/f</kbd>
  table cell movement in addition to arrow keys.
- **Single-letter global search**: on by default. Adds <kbd>s</kbd> as a
  shortcut for focusing global search. <kbd>Ctrl+K</kbd> remains available
  regardless of this setting.

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

When **Inherit namespace tags** is on, namespace-scoped resources also show tags
assigned to their namespace. Inherited tags are shown differently from direct
resource tags and do not create Kubernetes labels or annotations.

When **Cleanup missing resource assignments** is on, a fresh list that confirms
a resource is gone removes direct tag assignments in that visible scope.

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
matches. When disabled, generated chips are hidden but the normal text filter
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

## Configuration

Configuration views include ConfigMaps and Secrets. kview surfaces metadata,
usage signals where available, and YAML. Secret values are handled cautiously
and are not treated as normal display text.

## Access Control

Access control views include Service Accounts, Roles, Role Bindings, Cluster
Roles, and Cluster Role Bindings. These views help trace subjects, rules, and
bindings across namespaced and cluster-scoped RBAC.

## Storage

Storage views include Persistent Volume Claims and Persistent Volumes. They
show phase, capacity, storage class, binding state, related workloads, and
attention signals for low-confidence unused resources.

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
the in-app Help view and website, while \`CHANGELOG.md\` remains the complete
release history.

## Recent Highlights

- Help and user documentation now have a canonical repo source under
  \`docs/user\`, with an in-app Help surface planned around the same content.
- Dashboard, namespace summaries, and resource drawers use signals-first
  workflows so users can move from cluster-level attention to the exact
  resource that needs inspection.
- Settings support import/export, smart filters, resource tags, custom
  commands, custom workload actions, and dataplane policy tuning.
- Keyboard navigation includes shortcuts and command mode for faster resource,
  namespace, context, and settings navigation.

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
`},M=A,N=M.pages.filter(e=>e.surfaces.includes(`app`)).map(e=>({...e,body:j[e.id]||``})),P=M.featuredPages.map(e=>N.find(t=>t.id===e)).filter(e=>!!e);function F(e){let t=[];for(let n of e){let e=t.find(e=>e.category===n.category);e||(e={category:n.category,pages:[]},t.push(e)),e.pages.push(n)}return t}var I=`https://github.com/korex-labs/kview/blob/main/CHANGELOG.md`;function L(e,t){if(!t)return!0;let n=t.toLowerCase();return`${e.title} ${e.category} ${e.body}`.toLowerCase().includes(n)}function R(e){let t=e.body.replace(/\r\n/g,`
`).split(`
`);return t[0]?.trim().toLowerCase()===`# ${e.title.toLowerCase()}`?t.slice(1).join(`
`).trimStart():e.body}var z={flex:1,minHeight:0,display:`flex`,overflow:`hidden`,backgroundColor:`var(--bg-primary)`},B={flex:1,minWidth:0,overflow:`auto`,p:1.25,backgroundColor:`background.paper`,backgroundImage:e=>e.palette.mode===`dark`?`linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))`:`none`,"& .MuiPaper-root":{backgroundColor:`background.paper`,backgroundImage:e=>e.palette.mode===`dark`?`linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))`:`none`}};function V({onClose:e}){let[o,s]=(0,T.useState)(``),[C,w]=(0,T.useState)(P[0]?.id||N[0]?.id||``),D=(0,T.useMemo)(()=>N.filter(e=>L(e,o.trim())),[o]),O=(0,T.useMemo)(()=>F(D),[D]),A=N.find(e=>e.id===C)||D[0]||N[0],j=M.externalLinks,V=[j.github?{id:`github`,label:`GitHub`,href:j.github,icon:(0,E.jsx)(_,{fontSize:`small`})}:null,j.website?{id:`website`,label:`Website`,href:j.website,icon:(0,E.jsx)(g,{fontSize:`small`})}:null,j.patreon?{id:`patreon`,label:`Patreon`,href:j.patreon,icon:(0,E.jsx)(p,{fontSize:`small`})}:null].filter(e=>!!e);return(0,T.useEffect)(()=>{let t=t=>{t.key===`Escape`&&(t.preventDefault(),e())};return window.addEventListener(`keydown`,t),()=>window.removeEventListener(`keydown`,t)},[e]),(0,E.jsxs)(f,{"data-testid":`help-view`,sx:z,children:[(0,E.jsxs)(i,{variant:`outlined`,sx:S,children:[(0,E.jsx)(n,{variant:`overline`,color:`text.secondary`,sx:{display:`block`,mb:.25},children:`Help`}),(0,E.jsx)(c,{size:`small`,label:`Search help`,value:o,onChange:e=>s(e.target.value),sx:{my:1}}),(0,E.jsx)(r,{sx:{mb:1}}),(0,E.jsx)(f,{children:O.map(e=>(0,E.jsxs)(f,{sx:{mb:1},children:[(0,E.jsx)(n,{variant:`overline`,color:`text.secondary`,children:e.category}),(0,E.jsx)(a,{dense:!0,disablePadding:!0,children:e.pages.map(e=>(0,E.jsxs)(u,{selected:A?.id===e.id,onClick:()=>w(e.id),sx:v,children:[(0,E.jsx)(l,{sx:y(A?.id===e.id),children:(0,E.jsx)(m,{fontSize:`small`})}),(0,E.jsx)(t,{primary:e.title,slotProps:{primary:{variant:`body2`}},sx:x})]},e.id))})]},e.category))}),V.length?(0,E.jsxs)(E.Fragment,{children:[(0,E.jsx)(r,{sx:{my:1}}),(0,E.jsx)(n,{variant:`overline`,color:`text.secondary`,children:`Project`}),(0,E.jsx)(a,{dense:!0,disablePadding:!0,children:V.map(e=>(0,E.jsxs)(u,{component:`a`,href:e.href,target:`_blank`,rel:`noreferrer`,sx:v,children:[(0,E.jsx)(l,{sx:y(!1),children:e.icon}),(0,E.jsx)(t,{primary:e.label,slotProps:{primary:{variant:`body2`}},sx:x})]},e.id))})]}):null]}),(0,E.jsxs)(f,{sx:B,children:[(0,E.jsx)(f,{sx:{display:`flex`,justifyContent:`flex-end`,mb:1.25},children:(0,E.jsx)(b,{tooltip:`Close help`,label:`Close help`,onClick:e,children:(0,E.jsx)(h,{fontSize:`small`})})}),(0,E.jsx)(i,{variant:`outlined`,sx:{maxWidth:900,p:1.5},children:A?(0,E.jsxs)(E.Fragment,{children:[(0,E.jsxs)(f,{sx:{display:`flex`,alignItems:`center`,gap:.5,minHeight:36},children:[(0,E.jsx)(f,{sx:{display:`flex`,color:`primary.main`,mr:.25},children:(0,E.jsx)(m,{fontSize:`small`})}),(0,E.jsx)(n,{variant:`subtitle2`,component:`h1`,sx:{fontWeight:600},children:A.title}),A.id===`whats-new`?(0,E.jsx)(d,{href:I,target:`_blank`,rel:`noreferrer`,variant:`body2`,sx:{ml:`auto`},children:`Full changelog`}):null]}),(0,E.jsx)(r,{sx:{mb:1}}),(0,E.jsx)(k,{markdown:R(A)})]}):(0,E.jsx)(n,{variant:`body2`,color:`text.secondary`,children:`No help pages matched the current search.`})})]})]})}export{V as default};