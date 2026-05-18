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
**Tags** column. The text filter also supports `tag:<name>` to match assigned
or inherited tags.

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
