# Resource Tags

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
tags with `tag:<name>`. List cells show the first visible tags plus a `+N`
marker when additional tags are attached; hover the marker to see all tags for
that row.

When **Show tag quick filters** is enabled, visible list rows also produce
quick-filter chips for tags that are present in the current list. Selecting a
tag quick filter applies the same `tag:<name>` behavior as typing a tag filter.

When enabled, the cluster dashboard can also show tag chips in the signal
filters for tagged resources that have signals in the loaded signal set.

Namespace inheritance is enabled by default once Resource Tags are enabled. An
inherited tag appears on a namespaced resource because its namespace has that
tag. Removing the tag from the resource does not remove the namespace tag.

Auto-tagging rules are optional and live under the **Auto-Tagging** tab. A rule
can target any context or one selected context, any resource type or selected
resource types, and one source: `name`, `label`, or `annotation`. Label and
annotation rules can match a specific key or any value when the key is empty.
Patterns use regular expressions; invalid patterns are ignored until fixed.
Auto-tagged resources appear with the same tag chips and `tag:<name>` list
filter behavior as directly tagged resources.

Tag chips indicate where a tag came from. Direct tags use filled chips,
namespace-inherited tags use outlined chips, and auto-applied tags use a
spark icon with a dashed border. The drawer tag menu edits direct assignments
and shows auto-applied and inherited tags as read-only sections.

## Common Workflows

- Tag a namespace to make all related namespaced resources easier to spot.
- Tag a failing workload during an incident.
- Add an auto-tagging rule for labels such as `app.kubernetes.io/part-of` or
  names such as `^prod-`.
- Use `tag:<name>` in list filters to find tagged resources.
- Export settings to move tag definitions and assignments to another browser
  profile.

## Permission And Data Notes

Resource Tags are local kview data. They do not require Kubernetes write
permissions and are never sent as labels, annotations, or patches.

## Related Settings

- **Resource Tags**
- **Import / Export**
