# Custom Resources

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
