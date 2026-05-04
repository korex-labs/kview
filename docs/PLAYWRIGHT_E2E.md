# Playwright E2E and Screenshots

The Playwright suite runs the real kview UI against a real local Kubernetes connection. The backend is always started with `--read-only`, so destructive Kubernetes operations are rejected server-side even though action buttons and dialogs remain visible.

The UI toolchain expects Node.js `>=22.20.0`, matching `ui/package.json`.

## Commands

Default Make targets run inside the project Docker build image:

```bash
make e2e
make e2e-screenshots
```

Local escape hatches are available when you explicitly want to use the host toolchain:

```bash
make local-e2e
make local-e2e-screenshots
```

Useful environment overrides:

```bash
KVIEW_E2E_HOST_KUBECONFIG=$HOME/.kube/config make e2e
KVIEW_E2E_BACKEND_PORT=10444 KVIEW_E2E_UI_PORT=5173 make e2e-screenshots
```

When running through Docker, pass `KVIEW_E2E_HOST_KUBECONFIG` as a host file or directory. The Make target materializes a gitignored kubeconfig bundle in `.artifacts/e2e-kubeconfig`, dereferencing symlinked kubeconfig files, then mounts that bundle read-only at `/tmp/.kube` and passes that directory to kview.

If you prefer a gitignored repo-local kubeconfig, `.kube/e2e.kubeconfig` also works:

```bash
KVIEW_E2E_HOST_KUBECONFIG=$PWD/.kube/e2e.kubeconfig make e2e-screenshots
```

If your kubeconfig uses external certificate/key files or exec plugins, make sure those referenced paths are available inside Docker too, or flatten the kubeconfig before running the E2E suite. For exec plugins, Docker must be able to run the plugin command from the kubeconfig and read whatever credential cache it needs.

Use `KVIEW_E2E_DOCKER_EXTRA_ARGS` for provider-specific mounts and environment variables. Examples:

```bash
KVIEW_E2E_HOST_KUBECONFIG=$HOME/.kube/config \
KVIEW_E2E_DOCKER_EXTRA_ARGS='-v /usr/local/bin/kubelogin:/usr/local/bin/kubelogin:ro -v '$HOME'/.azure:/tmp/.azure:ro -e AZURE_CONFIG_DIR=/tmp/.azure' \
make e2e-screenshots
```

```bash
KVIEW_E2E_HOST_KUBECONFIG=$HOME/.kube/config \
KVIEW_E2E_DOCKER_EXTRA_ARGS='-v '$HOME'/.aws:/tmp/.aws:ro -e AWS_CONFIG_FILE=/tmp/.aws/config -e AWS_SHARED_CREDENTIALS_FILE=/tmp/.aws/credentials' \
make e2e
```

If the plugin only works reliably from the host environment, use the explicit local target instead:

For local, non-Docker runs, use `KVIEW_E2E_KUBECONFIG` directly:

```bash
KVIEW_E2E_KUBECONFIG=$HOME/.kube/config make local-e2e
```

Screenshots are written to:

```text
.artifacts/screenshots/
```

The screenshot project uses a `1920x1200` viewport, collapses the activity panel before capture, pauses briefly before each screenshot so tab/page transitions settle, and emits full-page screenshots. Current captures include:

- cluster dashboard
- namespace list and namespace detail
- pods list, pod overview, and pod containers
- deployments list and, when a live detail endpoint resolves, deployment detail
- nodes list and node detail
- Dataplane settings overview, enrichment, and signals tabs

## Sanitization

Playwright intercepts `/api/**` responses before the browser sees them. Resource names, namespaces, contexts, clusters, users, hosts, URLs, IPs, labels, annotations, selectors, and other sensitive displayed values are replaced with stable fake values such as `namespace-001` and `pod-001`.

The sanitizer keeps a reverse map for browser requests. If the UI clicks `namespace-001`, the outgoing API request is rewritten back to the real namespace before it reaches kview. This keeps screenshots sanitized while preserving real cluster navigation.

Human-facing signal labels and severities are left intact so screenshots remain useful for documentation. Kubernetes metadata label maps, annotation maps, selectors, endpoints, URLs, hosts, IPs, and resource names are still sanitized.

## Adaptive Selection

The screenshot flow chooses:

- a namespace with quota-related signals when available, otherwise another signaled namespace, otherwise the first namespace
- a running pod with signals or high metrics when available, preferring detail data where the first displayed container is running
- a namespace containing deployments for deployment screenshots
- several deployment candidates for details, skipping candidates whose live detail drawer reports a request failure

The suite avoids traces and videos by default because those artifacts may capture sensitive information outside the sanitized screenshot path.
