# RBAC

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
