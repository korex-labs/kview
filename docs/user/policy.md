# Policy

Policy views cover Network Policies, ResourceQuotas, and LimitRanges.

## What This View Is For

Use Policy views to inspect namespace traffic rules, quota usage, and default
resource constraints that can affect scheduling, startup, or connectivity.

## Network Policies

NetworkPolicy views are namespaced. They show selected pods, policy types,
ingress and egress rule counts, rule peers, rule ports, events, metadata, and
YAML. The drawer includes delete and YAML apply actions when permissions allow.
The namespace in the drawer links back to the Namespace detail view.

## ResourceQuotas

ResourceQuota views are namespaced. They show quota keys, used and hard values,
highest usage, gauges for quota entries that report ratios, events, metadata,
and YAML. The drawer includes delete and YAML apply actions when permissions
allow. Namespace capacity summaries and ResourceQuota signals can open the
matching ResourceQuota drawer directly.

## LimitRanges

LimitRange views are namespaced. They show limit item types plus configured
min, max, default, default request, and max limit ratio values, events,
metadata, and YAML. The drawer includes delete and YAML apply actions when
permissions allow. Namespace capacity summaries can open the matching
LimitRange drawer directly.

## Common Workflows

- Use Network Policies when traffic works in one namespace but not another.
- Use ResourceQuotas when pods fail to schedule or create due to namespace
  capacity limits.
- Use LimitRanges when workloads inherit unexpected default requests or limits.
- Check YAML when selector or rule summaries do not explain behavior.
- Use Namespace inventory and capacity links to move between namespace context
  and the exact Policy resource.

## Permission And Data Notes

Selected pod counts are best-effort and require pod list access in the
namespace. If pod reads are denied, the policy object is still shown without
selector match counts.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Actions And Safety**
