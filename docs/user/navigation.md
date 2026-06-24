# Navigation

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
namespace or `default`.

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
enabled, supported lists include a **Tags** column and `tag:<name>` text
filtering can match assigned or inherited tags.

## Drawers

Drawers keep the list visible while showing resource details. The Overview tab
focuses on operational state first: actions, attention signals, unhealthy
conditions, current state, and recent warnings.

Resource drawers also add **Notes** to the same tab strip as Overview, Events,
Metadata, and YAML. When a resource already has saved notes, the Notes tab shows
its current triage state as a small chip. This tab stores local operator
knowledge about the selected object. Use **Triage state** to record how
operators should treat the object: **Watch item**, **Known behavior**, **Do not
touch**, **Investigating**, or **Resolved**. Use **Operator note** for the short
context or decision, and **Reference link** for an optional runbook, ticket,
dashboard, or docs URL. Notes are keyed by context, resource kind, namespace,
and name; they stay local to the browser and are not written back to Kubernetes
annotations.

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

Use the header **Search or command** input to find resources from cached
dataplane snapshots or jump to resource views, namespaces, contexts, and
settings. Cached resource results can match by name, namespace, kind, or
cached health/signal context. Result rows show kind and match-reason chips,
namespace scope, and any cached health, status, or signal chips so failing
resources stand out before you open the drawer. Press <kbd>Ctrl+K</kbd> to
focus it. Type <kbd>:</kbd> to show command suggestions.

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
