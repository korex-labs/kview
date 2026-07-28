# Pods And Workloads

Pods and workload views cover day-to-day application inspection.

## What This View Is For

Use these views to inspect runtime state, readiness, images, restarts,
conditions, related pods, events, logs where available, and YAML.

## Resource Views

- **Pods**: individual running or completed pod instances.
- **Deployments**: rollout and replica state for Deployment workloads.
- **Stateful Sets**: ordered workload state and related pods.
- **Daemon Sets**: node-wide workload coverage and pod state.
- **Replica Sets**: replica controller state, usually owned by Deployments.
- **Jobs**: batch execution state.
- **Cron Jobs**: scheduled Job configuration and recent execution state.
- **HPA**: Horizontal Pod Autoscaler state and scaling targets.

## Drawer Tabs

Workload drawers focus on status first, then related resources. Pod drawers own
direct log streaming. Workload drawers that do not stream logs navigate to pods
for log inspection.

Pod drawer **Logs** controls include:

- **Container**: selects which container log stream to show.
- **Lines**: chooses the requested tail size. Available values are `100`,
  `500`, `1000`, and `5000`.
- **Filter pattern**: filters currently buffered log lines by text.
- **Pretty**: attempts to pretty-print JSON log lines. Lines that are not JSON
  stay as text.
- **Wrap lines**: wraps long log lines inside the log panel.
- **Follow**: opens or closes the live log stream. <kbd>L</kbd> opens the Logs
  tab and starts following when a Pod drawer is focused.

Logs depend on Pod log access for the selected container. kview streams current
container logs; it does not expose previous-container logs as a separate toggle.

## Pod Debug

Running Linux Pods can show **Debug** in the Pod drawer action bar. The dialog
adds one Kubernetes ephemeral container and opens it as a terminal in the
Activity Panel.

- **Target container** selects the regular container whose process namespace the
  runtime should target. Process visibility still depends on runtime support.
- **Debug image** and **Shell** use the defaults configured in Settings and can
  be changed for the current launch.
- **Baseline** is the only current profile. kview does not request privileged mode
  or added Linux capabilities. Baseline is intentionally not the stricter
  Restricted profile: it does not force non-root execution, `drop: ALL`, seccomp,
  or `allowPrivilegeEscalation: false`, because those settings require a
  compatible debug image. Cluster admission policy remains authoritative and can
  accept, default, or reject the image and container specification.
- Startup status, including image-pull waiting reasons, appears in the terminal
  before kview attaches to the shell.

Kubernetes does not allow an ephemeral container to be removed or changed after
it is added. Exiting or explicitly closing the Pod Debug terminal terminates its
shell, but the container entry and terminated status remain until the Pod is
recreated. Closing the browser or losing the connection alone does not promise
that the shell has terminated.

## Jobs And Cron Jobs

Job drawers include **Rerun**. This creates a fresh Job from the selected Job's
pod template. CronJob drawers include **Run now**. This creates a one-off Job
from the selected CronJob's job template. CronJob drawers also include
**Suspend** or **Resume** based on the current `spec.suspend` state. This is a
temporary live change to the Kubernetes object; Helm or another reconciler may
overwrite it on the next sync or upgrade.

Both actions include the optional **Open debug run** checkbox. When enabled,
kview starts the Job and opens a debug dialog that streams:

- **Timeline**: creation, status, warning, and error records.
- **Logs**: container log lines from the debug run.
- **Events**: Kubernetes events observed for the run.

The debug dialog includes **Stop job**. Press it once to arm the destructive
action, then press **Confirm stop job** to stop the debug Job. Closing the
dialog stops watching the debug session; it does not mean the normal Job or
CronJob action succeeded without checking the final Job state.

## Common Workflows

- Open **Dashboard** signals for pod restarts, CrashLoopBackOff, image pull
  failures, unschedulable pods, or workload availability.
- Navigate to the workload list and filter by namespace, name, image, status,
  or tag.
- Open a drawer and review **Overview**, **Conditions**, **Events**, and
  related pods.
- For logs, open the relevant pod drawer, choose the container, and use
  **Follow** only while you need live updates.
- Use **Rerun** or **Run now** for batch workloads when you need a new Job from
  the existing template. Use **Open debug run** when you also want live status,
  events, and logs for that manual run.
- Use guarded actions such as restart, scale, delete, terminal, Pod Debug, port
  forward, or custom commands only after reviewing current state.

## Permission And Data Notes

Workload actions depend on RBAC. Logs, terminal sessions, and port forwards may
require permissions beyond list/read access. Job rerun, CronJob run, and debug
run actions require permission to create Jobs in the namespace. Stopping a
debug run requires permission to stop or delete the generated Job. CronJob
suspend and resume require patch or update permission on CronJobs. Metrics
appear only when metrics.k8s.io is available and allowed. During a background
metrics refresh, kview keeps the previous sample visible until a replacement is
available instead of briefly clearing the CPU and Memory columns.

Pod Debug additionally requires `get` on `pods`, `patch` on
`pods/ephemeralcontainers`, and `create` on `pods/attach`. It is unavailable in
read-only mode and does not support Windows Pods or static/mirror Pods. A
positive permission check only enables the workflow; Kubernetes RBAC, admission,
image pulling, kubelet state, and the container runtime make the final decision.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Custom Commands**
- **Pod Debug** defaults are configured on the **Custom Commands** settings page.
- **Custom Actions**
- **Dataplane**
