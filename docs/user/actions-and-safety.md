# Actions And Safety

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
- Pod Debug
- Container command presets
- Workload action presets
- RBAC operations
- Helm install, upgrade, and uninstall

## Common Workflows

Mutating operations go through a review dialog. Destructive or high-impact
changes require explicit confirmation before kview sends the request.

**Pod Debug** is an irreversible Pod-spec mutation: Kubernetes can add an
ephemeral container but cannot remove or change it afterwards. The launch dialog
states this before creation. Exiting the shell terminates the container process;
the Pod retains the ephemeral container entry until recreation.

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
