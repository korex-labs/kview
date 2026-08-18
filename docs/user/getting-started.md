# Getting Started

kview is a local Kubernetes UI for fast cluster exploration. It reads your
kubeconfig, starts a local server, and opens the UI in a browser or desktop
webview depending on how the binary was built.

## Download A Release

Tagged releases are available from
[GitHub Releases](https://github.com/korex-labs/kview/releases). Choose the regular
binary for browser/server mode on Linux, macOS, or Windows.

Linux amd64 and macOS releases also include desktop assets named:

```text
kview-<version>-linux-amd64-webview
kview-<version>-linux-amd64-desktop.tar.gz
kview-<version>-darwin-amd64-webview
kview-<version>-darwin-arm64-webview
kview-<version>-darwin-amd64-app.zip
kview-<version>-darwin-arm64-app.zip
```

They open the embedded UI in a native window by default. For Linux application-menu
and desktop integration, extract the `desktop.tar.gz` bundle and run
`./install.sh`; it installs the binary, launcher, and icon for the current user
under `~/.local`. Linux requires GTK 3 and WebKitGTK 4.1 runtime libraries.

On macOS, extract the architecture-matching `app.zip` and launch `kview.app` for
normal Finder and Dock integration. Choose `darwin-amd64` for an Intel Mac or
`darwin-arm64` for Apple Silicon. The raw webview binaries remain available for
shell use.

The macOS assets are ad-hoc signed but not Apple-notarized. Depending on your
Gatekeeper policy, the first launch may require approving kview in **System
Settings → Privacy & Security**. The regular Windows `.exe` includes the kview
application icon for Explorer and shortcuts, but Windows webview assets are not
published yet. Webview assets for Linux arm64 are also not published yet; use the
regular release binary on those platforms. A Finder-launched app inherits the
macOS GUI environment; if a kubeconfig exec plugin is not on that `PATH`, run the
raw webview binary from a shell or configure the plugin with an absolute command
path.

After downloading a raw Linux or macOS binary, make it executable before running it:

```bash
chmod +x kview-*
```

## First Run

Start kview from a shell that can already access your Kubernetes contexts:

```bash
kview
```

If you need a specific kubeconfig file or directory, pass `--config`:

```bash
kview --config ~/.kube/my-config
```

kview uses the same client-go authentication flow as other Kubernetes tools. If
your kubeconfig uses an exec auth plugin, the referenced command must be
installed and available on `PATH`.

## Kubeconfig Resolution

kview resolves kubeconfig locations in this order:

1. `--config`
2. `KUBECONFIG`
3. the default kubeconfig path, usually `~/.kube/config`

`--config` and `KUBECONFIG` can point to one file, one directory, or multiple
locations separated by the operating system path-list separator. On Linux and
macOS that separator is `:`. On Windows it is `;`.

When a location is a file, kview reads that file. When a location is a
directory, kview reads the files directly inside that directory in name order.
Directory loading is not recursive: nested directories are skipped. Missing
locations are skipped and reported in startup logs.

The resolved files are passed to Kubernetes client-go as the kubeconfig loading
precedence. Local paths inside kubeconfig files are resolved by client-go. For
exec authentication plugins, kview also provides the effective kubeconfig file
list through `KUBECONFIG` unless the exec environment already defines it.

The startup dialog shows the default path and the exact readable files kview
resolved for the current run.

## What To Check First

- Use the context selector to choose the cluster you want to inspect.
- Choose a namespace for namespaced resources.
- Open Dashboard for cluster-level health and attention signals.
- Open Pods, Deployments, Services, Ingresses, or Helm Releases for common
  day-to-day views.
- Select a row to open its drawer, then use tabs for overview, related
  resources, events, metadata, and YAML.

## Permissions

kview adapts to your Kubernetes permissions. If your account cannot list a
resource, the UI shows an access-denied state instead of failing the whole app.
Mutation buttons are hidden or disabled when RBAC does not allow the action.
