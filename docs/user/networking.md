# Networking

Networking views cover Services and Ingresses.

## What This View Is For

Use Networking views to trace traffic routing from Kubernetes Service or
Ingress objects to selected pods, backends, endpoints, hosts, and TLS entries.

## Services

Service views focus on type, cluster IP, ports, selectors, endpoint readiness,
and related pods or workloads. They are useful when a workload is running but
traffic does not appear to reach it.

## Ingresses

Ingress views focus on class, hosts, addresses, TLS, rules, default backends,
and backend service readiness. kview surfaces routing warnings when backend
services or ready endpoints are missing.

## Common Workflows

- Start from an Ingress and inspect backend services.
- Open a Service and verify selectors and endpoint readiness.
- Navigate from related pods back to workload drawers for logs and conditions.
- Use events and YAML when routing behavior does not match the expected spec.

## Permission And Data Notes

Networking diagnosis often depends on reading related resources. If kview can
read the Service but not pods or `discovery.k8s.io/v1` EndpointSlices, related
sections may be partial or empty. The view reflects visible Kubernetes data
only.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Dataplane**
