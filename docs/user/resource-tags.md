# Resource Tags

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
- **Cleanup missing resource assignments**: when enabled, removes direct tag
  assignments for non-namespace resources only after an authoritative fresh
  list confirms the resource is gone.
- **Add tag**: creates a tag definition with name and color.
- **Tag assignment menu**: opens from supported drawer headers.
- **Dynamic link chips**: when Links & Macros are enabled and a link resolves,
  link chips appear next to tag chips in the drawer header.

## Optional Behavior

Resource Tags are disabled by default. When disabled, tag columns and drawer
tag controls are hidden. When enabled, supported lists show a **Tags** column
and list filtering can match tags with `tag:<name>`.

When enabled, the cluster dashboard can also show tag chips in the signal
filters for tagged resources that have signals in the loaded signal set.

Namespace inheritance is enabled by default once Resource Tags are enabled. An
inherited tag appears on a namespaced resource because its namespace has that
tag. Removing the tag from the resource does not remove the namespace tag.

## Common Workflows

- Tag a namespace to make all related namespaced resources easier to spot.
- Tag a failing workload during an incident.
- Use `tag:<name>` in list filters to find tagged resources.
- Export settings to move tag definitions and assignments to another browser
  profile.

## Permission And Data Notes

Resource Tags are local kview data. They do not require Kubernetes write
permissions and are never sent as labels, annotations, or patches.

## Related Settings

- **Resource Tags**
- **Import / Export**
