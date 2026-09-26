# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- Resource maps now offer interactive pan, zoom, and fit controls, with clearer
  relationship details and rollout history for investigating connected resources.
- Helm release maps show manifest resources alongside cached availability and
  links to resource drawers, making missing or unknown evidence easier to spot.
- Optional **Live** updates now follow Pods, Deployments, Stateful Sets, Daemon
  Sets, Replica Sets, Jobs, and Cron Jobs in the selected namespace. Live is off
  by default and shows when updates are paused, reconnecting, or blocked.
- Pod and workload tables now offer **Refresh** when Live is off, keeping
  filters, selection, scroll, and open drawers. Slow metrics no longer hold up
  Pod status loading.
- **Explain** dialogs on resource lists, the Dashboard's **Dataplane** tab, and
  Kubernetes resource maps clarify cache freshness and coverage without reading
  Kubernetes again.
- Custom resources now offer read-only **Spec** and **Status**, generation
  evidence, and independently loaded Events. Browse an exact kind and served
  version using Kubernetes printer columns and manual pagination.
- Helm's **Recovery** tab now previews guarded deletion of an eligible latest
  pending-upgrade or pending-rollback history Secret. This confirmed action
  removes one history record; it does not roll back or uninstall resources.
- Narrow drawers now provide tab scroll arrows and a **More** menu. Pod metadata
  and YAML are grouped under **Object**, with existing shortcuts preserved.
- Pod terminals retain input focus during list updates, and **Terminal** opens
  the only running container directly when no container choice is needed.
- The main interface now opens while namespace inventory loads in the
  background, with **Retry namespaces** available for failed or empty results.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/master/CHANGELOG.md)
in the repository for the complete release history.
