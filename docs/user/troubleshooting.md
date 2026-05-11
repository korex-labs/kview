# Troubleshooting

Use this page when kview starts but cannot show expected cluster data, actions,
metrics, or cached state.

## No Contexts Found

kview did not find a usable Kubernetes context. Confirm that the shell running
kview has the expected kubeconfig and that `kubectl config get-contexts` works
from the same environment.

kview checks `--config` first, then `KUBECONFIG`, then the default path
`~/.kube/config`. If `--config` or `KUBECONFIG` points at a directory, kview
loads files directly inside that directory in name order and skips nested
directories. If you store kubeconfigs in nested folders, pass each file or
directory explicitly with the platform path-list separator, such as `:` on
Linux and macOS or `;` on Windows.

The startup dialog lists the readable files kview actually tried to load. Use
that list to catch typos, missing mounted files, unexpected environment
variables, or a process launched from a different shell than the one where
`kubectl` works.

## Authentication Fails

If your kubeconfig uses an exec auth plugin, install the referenced command and
make sure it is available on `PATH`. Cloud-provider CLIs and kubelogin tools
must be available to the kview process.

kview passes the effective kubeconfig file list to exec auth plugins through
`KUBECONFIG` unless the plugin environment already defines `KUBECONFIG`.

## Access Denied

Access denied states usually mean your Kubernetes account lacks permission for
that resource. kview continues showing other resources where access is allowed.

## Data Looks Partial

Some views use cached snapshots and degraded payloads so useful data remains
visible even when direct reads are limited. Check freshness, coverage, and
degradation metadata on list pages and dashboard panels.

## Metrics Are Missing

Metrics require metrics.k8s.io to be installed and allowed by RBAC. If metrics
are unavailable, kview hides usage widgets instead of failing the view.

## Local Cache Issues

Dataplane persistence is optional. If cache migration fails or stale data is
confusing, disable persistence in Settings or clear the local cache file outside
of kview.

## Related Settings

- **Check for kview updates**
- **Dataplane**
- **Metrics**
- **Resource Tags**
- **Import / Export**
