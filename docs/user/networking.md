# Networking

Networking views cover Services and Ingresses.

## What This View Is For

Use Networking views to trace traffic routing from Kubernetes Service or
Ingress objects to selected pods, backends, endpoints, hosts, and TLS entries.

## Services

Service views focus on type, cluster IP, ports, selectors, endpoint readiness,
and related pods or workloads. They are useful when a workload is running but
traffic does not appear to reach it.

The **Endpoints** column shows a ready/total count only after kview successfully
observes EndpointSlices for the namespace. It shows **Unknown coverage** when
EndpointSlice access failed or a legacy persisted snapshot lacks observation
state. Unknown coverage is not treated as zero endpoints.

## Ingresses

Ingress views focus on class, hosts, addresses, TLS, rules, default backends,
and backend service readiness. kview surfaces routing warnings when backend
services or ready endpoints are missing.

Cache-backed routing signals distinguish these cases:

- the Service selector matches no cached Pods;
- matching Pods exist, but the Service has no ready endpoints;
- an Ingress backend Service is missing;
- an Ingress backend port is not exposed by the Service;
- the backend Service exists and exposes the port, but has no ready endpoints.

Signal evidence identifies the selector or Ingress route, referenced Service
and port, matching Pod count when known, and endpoint observation result.

## Common Workflows

- Start from an Ingress and inspect backend services.
- Open a Service and verify selectors and endpoint readiness.
- Navigate from related pods back to workload drawers for logs and conditions.
- Use events and YAML when routing behavior does not match the expected spec.

## Permission And Data Notes

Networking diagnosis often depends on reading related resources. If kview can
read the Service but not pods or `discovery.k8s.io/v1` EndpointSlices, related
sections may be partial or empty. The view reflects visible Kubernetes data
only. kview does not report a missing selector match unless cached Pod label
coverage is complete, and it does not report missing ready endpoints unless the
EndpointSlice observation completed successfully. `ExternalName` and
selectorless Services are not classified as selector mismatches.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Dataplane**
