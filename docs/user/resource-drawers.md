# Resource Drawers

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
