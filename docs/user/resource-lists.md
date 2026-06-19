# Resource Lists

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
**Tags** column. The text filter also supports `tag:<name>` to match assigned
or inherited tags. When a row has more tags than the list cell shows, kview
adds a `+N` indicator; hover it to see the full tag list.

**Resource tag cleanup** is optional. When enabled, kview removes direct tag
assignments for non-namespace resources in a visible scope only after an
authoritative fresh list confirms that a resource no longer exists.

## Status Metadata

Many lists show dataplane metadata above the table. This can include freshness,
coverage, degradation, completeness, and state. Use this strip to understand
whether rows came from live reads, cached snapshots, partial visibility, or a
degraded fallback.

## Common Workflows

- Filter by a resource name, owner, image, status, or `tag:<name>`.
- Use generated chips to jump to a repeated naming pattern.
- Save a filtered or customized list when you frequently return to the same
  context, namespace, resource type, filter, sort order, or column layout.
- Select a saved view from any resource list to return to its saved location
  and table layout, or to jump back to a saved dashboard signal view.
- Resize dense columns when values are clipped.
- Hover tag overflow indicators when the Tags column has a `+N` marker.
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
- Click the **Clear saved view** `X`, or select **No saved view**, to leave
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
