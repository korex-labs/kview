# Storage

Storage views cover Persistent Volume Claims and Persistent Volumes.

## What This View Is For

Use Storage views to inspect binding state, storage class, capacity, related
workloads, and low-confidence unused-resource signals.

## Persistent Volume Claims

PVC views are namespaced. They show claim phase, requested capacity, storage
class, bound volume, age, events, metadata, YAML, and related workload usage
when visible.

## Persistent Volumes

PV views are cluster-scoped. They show phase, capacity, storage class, reclaim
policy, claim reference, events, metadata, and YAML.

## Common Workflows

- Start from Dashboard PVC signals when looking for potentially unused storage.
- Open a PVC and inspect related workloads before deleting anything.
- Check events and YAML when a claim is pending or a volume is released.
- Use tags for local investigation state.

## Permission And Data Notes

Unused-storage signals are intentionally low confidence. Confirm workload
usage, claim state, events, and ownership before taking destructive action.

## Related Settings

- **Dashboard And Signals**
- **Resource Tags**
- **Dataplane**
