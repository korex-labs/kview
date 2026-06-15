# Smart Filters

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
