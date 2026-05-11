# Common Workflows

This page collects practical paths through kview for common operator tasks.

## Investigate A Failing Pod

- Open **Dashboard** and select a pod or workload signal.
- Navigate to the pod or workload drawer.
- Review **Overview**, conditions, warning events, and restart information.
- Open **Logs** on the pod drawer when available.
- Check YAML only after reviewing higher-level state.

## Trace Ingress To Pods

- Open **Ingresses** and select the relevant Ingress.
- Review hosts, TLS, rules, and backend services.
- Open the related Service.
- Check selectors and endpoint readiness.
- Navigate to related pods for logs or conditions.

## Review Potentially Unused Storage

- Start from Dashboard PVC signals or the PVC list.
- Open the PVC drawer and review phase, age, bound volume, events, and related
  workloads.
- Confirm ownership from labels, annotations, and YAML before deleting.

## Use Tags During An Incident

- Enable **Resource Tags**.
- Create a temporary tag such as `incident` or `watch`.
- Assign it to namespaces or resources under investigation.
- Use `tag:<name>` filters to return to the same set quickly.
- Export settings if the tag set needs to move to another browser profile.

## Safely Apply A Change

- Open the resource drawer.
- Review **Overview**, events, and YAML.
- Use a guarded action or YAML edit flow only when the current state matches
  the intended target.
- Confirm warnings and typed confirmations before applying.
- Watch the Activity Panel and refresh the related list or drawer after the
  change.

## Permission And Data Notes

Workflows are limited by the active context and Kubernetes RBAC. If kview shows
partial data, use metadata strips, access-denied states, and drawer warnings to
understand what is visible before acting.
