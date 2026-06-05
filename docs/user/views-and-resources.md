# Views And Resources

kview covers common Kubernetes resources and related operator workflows.

## What This Is For

Resource views provide list-first navigation into Kubernetes objects, related
resources, signals, events, metadata, and YAML.

## Dashboard

Dashboard summarizes cluster and namespace health. It shows totals, workload
state, namespace snapshots, node summaries, and attention signals.

Signals are designed for triage. They include severity, likely cause, suggested
action, and quick-filter keys when available.

Dashboard signal filtering has optional behavior controlled by Settings:

- By default, selecting a signal chip replaces the active filter.
- With **Combined dashboard signal filters** enabled, non-derived signal chips
  can be selected together. kview requests the selected filters as one combined
  signal query and narrows the remaining chip choices to matching signals.
- With **Dashboard favourite namespace filters** enabled, the dashboard includes
  signal chips for favourited namespaces in the active context.
- With **Dashboard recent namespace filters** enabled, the dashboard includes
  signal chips for recently visited namespaces in the active context.

Dashboard refresh cadence is configured in Dataplane settings, not in the
Appearance section. Wide and diagnostic dataplane profiles apply a minimum
refresh floor so broad dashboard refreshes do not run too aggressively.

## Workloads

Workload views include Pods, Deployments, StatefulSets, DaemonSets, ReplicaSets,
Jobs, CronJobs, and Horizontal Pod Autoscalers.

Use these views to inspect readiness, age, images, restarts, conditions,
related resources, logs where supported, and YAML.

## Networking

Networking views include Services and Ingresses. They focus on selectors,
endpoints, backend readiness, hosts, TLS, and related pods or workloads.

## Policy

Policy views include Network Policies, ResourceQuotas, and LimitRanges. They
show namespace traffic policy, resource quota usage, default/min/max limits,
and the selectors or rules that influence workload admission and connectivity.

## Configuration

Configuration views include ConfigMaps and Secrets. kview surfaces metadata,
usage signals where available, and YAML. Secret values are handled cautiously
and are not treated as normal display text.

## Access Control

Access control views include Service Accounts, Roles, Role Bindings, Cluster
Roles, and Cluster Role Bindings. These views help trace subjects, rules, and
bindings across namespaced and cluster-scoped RBAC.

## Storage

Storage views include Persistent Volume Claims and Persistent Volumes. They show
phase, capacity, storage class, binding state, related workloads, and attention
signals for low-confidence unused resources.

## Helm

Helm views include releases and chart catalog rows derived from cached cluster
state. Release actions are capability-aware and use the same guarded mutation
flow as Kubernetes resource actions.

## Extensions

Extension views include Custom Resource Definitions, namespaced custom
resources, and cluster-scoped custom resources. These views help discover and
inspect CRDs without requiring kview-specific code for each custom kind.

## Permission And Data Notes

Resource visibility follows the active Kubernetes context and RBAC permissions.
When kview cannot read a resource directly, it may still show derived or cached
data if the dataplane already has enough visible snapshots to build a useful
view. List metadata describes freshness, coverage, degradation, and completeness
when that information is available.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Smart Filters**
- **Dashboard signal filter options**
