# What's New

This page is a curated summary of recent user-facing changes. It is meant for
the in-app Help view and website, while the full changelog remains in the
repository.

## Recent Highlights

- Saved resource views let operators return to frequently used list setups
  quickly, while backend-driven view policies keep sorting, filters, labels,
  and actions more consistent across resource types.
- Resource drawers now surface tags and Resource Macros together, with tag
  automation support to speed up repeated tagging workflows on live resources.
- Operator and dashboard settings profiles make it easier to switch between
  different browsing and signal-triage setups.
- Keyboard workflows are more predictable across drawers and Help surfaces,
  with shared focus scopes improving escape handling and layered navigation.
- Policy resources now have a dedicated sidebar group and richer drawers for
  NetworkPolicies, ResourceQuotas, and LimitRanges, making namespace traffic
  and capacity policy easier to inspect.
- Custom resource browsing is more polished, with stronger list and drawer
  workflows and Helm chart version manifests shown when available for related
  releases.
- YAML apply flows now use guarded patching so live changes are reviewed and
  confirmed more safely before being sent to the cluster.
- Header search and command entry now share one unified workflow, with updated
  autocomplete behavior for faster navigation and action discovery.

## Full History

See [CHANGELOG.md](https://github.com/korex-labs/kview/blob/main/CHANGELOG.md)
in the repository for the complete release history.
