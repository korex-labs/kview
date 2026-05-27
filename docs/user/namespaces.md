# Namespaces

Namespaces provide scope-level summaries for namespaced resources.

## What This View Is For

Use Namespaces to find active, unhealthy, empty, or resource-heavy namespaces
and drill into the resources behind those summaries.

## List Columns And Filters

The namespace list can include health, age, workload counts, Helm releases,
RBAC counts, resource coverage, and favourite state depending on available
dataplane data.

Filtering can match namespace names and, when Resource Tags are enabled,
assigned namespace tags.

The **Quota** column is populated by progressive namespace row enrichment. It
shows ResourceQuota and LimitRange counts as `ResourceQuotas / LimitRanges`.
When ResourceQuota usage is available, the chip can include the highest usage
percentage and switch to warning or critical state. Rows that are still waiting
for enrichment show `-`.

## Drawer Tabs

Namespace drawers summarize workload health, signals, related resource counts,
events, metadata, and YAML. Namespace insights can link from a namespace-level
signal to the exact resource that contributed to it when that identity is
available.

The namespace **Signals** section uses the same signal action pattern as the
dashboard: severity, acknowledgement, and investigation. When a namespace list
row reports a signal because a contained resource needs attention, the drawer
also includes a fallback signal for that problematic resource so the list badge
and drawer signal table stay aligned.

The **Capacity** tab shows:

- namespace resource usage from cached pod metrics when metrics.k8s.io is
  available and allowed
- ResourceQuota count, LimitRange count, and warning or critical quota entry
  counts
- each ResourceQuota entry with used value, hard limit, and usage gauge when a
  ratio can be calculated
- each LimitRange item with min, max, default, and default request values

Quota pressure uses the same percent thresholds exposed by signal
customization. By default, entries at or above `80%` are warning and entries at
or above `90%` are critical.

## Common Workflows

- Favourite namespaces you inspect often.
- Enable **Smart namespace sorting** to promote favourites and recent
  namespaces in the namespace selector.
- Open namespace signals from Dashboard and inspect the related namespace
  drawer.
- Use the namespace list **Quota** column to find namespaces with quota
  pressure before opening the drawer.
- Open **Capacity** when you need the exact ResourceQuota key, used value, hard
  limit, or LimitRange default that produced a warning.
- Use namespace tags to mark ownership or investigation state locally.

## Permission And Data Notes

Namespace summaries depend on visible namespaced resources. If the active
account can list namespaces but not related workloads, counts and signals may
be partial. Quota and limit information requires access to ResourceQuota and
LimitRange resources in the namespace. Resource usage requires metrics.k8s.io
and RBAC for the relevant metrics reads.

## Related Settings

- **Smart namespace sorting**
- **Dashboard favourite namespace filters**
- **Dashboard recent namespace filters**
- **Resource Tags**
- **Dataplane**
