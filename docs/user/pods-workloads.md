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
direct log streaming. In the **Pods** tab of Deployment, Stateful Set, Daemon
Set, Replica Set, and Job drawers, use a related Pod's **Logs** button to open
its Logs tab and automatically follow current logs once the Pod UID and container
are known. Clicking the Pod row instead opens its Overview without a log stream.
These are individual Pod logs, not an aggregated workload stream.

The Pod drawer groups metadata and YAML in **Object**, with icon-labelled
**Details** and **YAML** controls:

- **Details** shows labels and annotations.
- **YAML** uses the existing viewer and permission-dependent edit workflow.
- Configured Metadata and YAML shortcuts open the matching Object view directly,
  including when Object is outside the visible tab row.

Use the tab-row arrows or **More** in a narrow drawer to reach other sections.
This grouping currently applies to Pods; other workload drawers retain their
separate Metadata and YAML tabs.

Pod drawer **Logs** opens with **Current**, **100** lines, **Follow**, **Pretty JSON**,
and **Wrap** enabled. The compact toolbar fits one row when space permits and
wraps to two rows in narrow drawers. Icon controls have tooltips and selected states.

- **Container** selects the container and automatically loads its logs.
- **Lines** chooses the requested tail: `100` (default), `500`, `1000`, or `5000`.
- **Filter** applies a plain, case-insensitive substring filter to buffered lines.
- **Current** (play icon) selects the current container instance; it is not a pause button.
- **History** selects the last terminated instance of that container, stops the
  old stream, clears its buffer, and automatically reads previous logs once.
  Kubernetes may no longer have these logs.
- **Follow** is separate from source selection. Turn it off to stop the stream
  and retain buffered lines, or on to start a fresh current-log read. It is disabled
  for History. Its selected state is your preference, not a connection indicator.
- **Pretty JSON** formats JSON lines; non-JSON lines stay as text.
- **Wrap** wraps long lines. Filter, Pretty JSON, and Wrap are local display
  controls and never open a connection.
- <kbd>L</kbd> opens Logs when a Pod drawer is focused; pressing it again does
  not open a duplicate stream.

Lines, Pretty JSON, and Wrap are saved globally in your browser settings and reused
across Pods, drawers, and page reloads. With no saved preferences, they default to
100 lines, Pretty JSON on, and Wrap on. They are included in settings exports and
operator profiles, including the **Log preferences** transfer section. Changing Container or source preserves these preferences and
Filter; it enables Follow for Current. Follow and source selection remain scoped
to the drawer. Changing Lines automatically refetches
without resetting your formatting or Follow choice; with Follow off this is a finite read.
Leaving Logs, closing the drawer, switching Pod/namespace/context, or losing cluster
connectivity stops the stream. Returning to Logs loads the selected source again.
Errors and end-of-stream status remain visible without an automatic reconnect loop;
use **Retry** beside the status to read again.

Reads require Pod details and Pod log access. The server checks the loaded Pod UID
before opening logs and rejects a known replacement with the same name; reopen the
drawer to inspect that replacement.

Previous logs are not a historical archive and do not include deleted Pods.
Workload Pod rows resolve the named Pod when opened, so a replacement since the
workload snapshot may be the Pod whose details you see. UID checking occurs
before opening the stream, not atomically with the Kubernetes log request.

The **Live** control tooltip explains event-driven updates versus periodic
polling and what clicking will switch to. When Live reports a problem, the
reason remains visible alongside this guidance.

## Terminal

The Pod drawer's **Terminal** action opens the only available running container
immediately. If several running containers are available, choose one from the
menu. With no running containers, the action is disabled. Cluster access checks
still apply.

Filtering the resource table before opening a Pod does not give the filter
ownership of terminal input: subsequent list updates leave terminal focus alone.

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

Pod status loading and metrics refresh run independently: slow or unavailable
metrics do not hold up the Pod list. With Live off, while the page is visible,
Pods periodically request dataplane-backed data even without metrics; automatic
reads still obey snapshot freshness policy. This default mode is polling.

The **Refresh** button beside **Explain** in Pods, Deployments, Stateful Sets,
Daemon Sets, Replica Sets, Jobs, and Cron Jobs updates the selected namespace
without reloading the application. It keeps rows, filters, selection, scroll, and
an open drawer while the request runs. When the dataplane policy permits manual
TTL bypass, it fetches source data even if the existing snapshot is still fresh.
This does not bypass Kubernetes permissions or scheduler limits.

### Live Pods And Workloads

**Live=polling** is the default neutral chip in the metadata row. Click it (or
focus it and press <kbd>Enter</kbd> or <kbd>Space</kbd>) to enable Live and follow
changes for the active resource kind in the selected context and namespace
through Kubernetes LIST/WATCH rather than waiting for the ordinary polling
interval. Live is optional and off by default. It is available only for **Pods**,
**Deployments**, **Stateful Sets**, **Daemon Sets**, **Replica Sets**, **Jobs**,
and **Cron Jobs**. HPA and all other resource lists do not offer this Live mode.

The subscription is bounded to that exact context, namespace, and kind; there is
no all-namespace or all-kind subscription. Favorites do not automatically start
subscriptions. Changing context, namespace, or resource view releases the old
subscription; leaving the view stops it.

- **Live=starting** is warning-colored: the stream or its displayed snapshot is
  not ready yet.
- **Live=live** is success-colored only after the table applies a non-stale
  snapshot at least as new as the stream revision. A connected stream alone is
  not proof that the displayed rows are current.
- **Live=reconnecting**, **Live=paused**, and **Live=stopped** are warning-colored;
  **Live=blocked** is error-colored. Existing rows may be stale in these states;
  they do not promise current data. Hover the chip for the server reason when available.
- The chip stays the same compact size in every state. Click it again to disable Live.
  **Refresh** is hidden while Live is enabled and returns when Live is off.
- Hiding the browser tab pauses the subscription. Returning resumes it if Live
  remains enabled. Transient stream failures reconnect with backoff. Ordinary
  polling stays suspended while Live is enabled, including reconnecting, blocked,
  or stopped states; turn Live off to restore polling and manual **Refresh**.
  Permission failures do not trigger a broader or more privileged subscription.
- A transient snapshot-read failure retries with backoff even if no new resource event
  arrives. Permission failures are not bypassed.

Updates preserve the table and open drawer for the same resource instance.
Deleting the selected resource or replacing its UID clears its selection and
drawer, rather than silently treating another resource with the same name as
the original.

Live updates list snapshots, not every source of evidence in a drawer. Metrics
have their own sampling cadence and may lag behind resource status. Details,
related resources, logs, and **Events** retain their separate loading behavior.
In particular, **Cron Jobs** Live follows the CronJob resource and its status;
Kubernetes Events and event-derived schedule warnings are not streamed. The
separate **Open debug run** workflow described above is unchanged.

Live does not promise every intermediate Kubernetes state or zero latency. To
use manual **Refresh**, turn Live off first.

Pod Debug additionally requires `get` on `pods`, `patch` on
`pods/ephemeralcontainers`, and `create` on `pods/attach`. It is unavailable in
read-only mode and does not support Windows Pods or static/mirror Pods. A
positive permission check only enables the workflow; Kubernetes RBAC, admission,
image pulling, kubelet state, and the container runtime make the final decision.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Custom Commands**
- **Pod Debug** defaults are configured on the **Pod Debug & Commands** settings page.
- **Custom Actions**
- **Dataplane**
