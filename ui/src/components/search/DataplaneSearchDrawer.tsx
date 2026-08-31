import type { ApiDataplaneSearchItem } from "../../types/api";
import HelmReleaseDrawer from "../resources/helm/HelmReleaseDrawer";
import NamespaceDrawer from "../resources/namespaces/NamespaceDrawer";
import ResourceIdentityDrawer from "../shared/ResourceIdentityDrawer";

type Props = {
  token: string;
  item: ApiDataplaneSearchItem | null;
  onClose: () => void;
  onNavigate?: (section: string, namespace: string) => void;
};

/** Search adapter around the shared canonical-resource drawer dispatcher. */
export default function DataplaneSearchDrawer({ token, item, onClose, onNavigate }: Props) {
  const open = Boolean(item);
  const namespace = item?.namespace || "";
  const name = item?.name || null;

  // Preserve search-specific navigation and virtual Helm behavior. Helm rows are
  // intentionally not passed to the Kubernetes Resource Map identity registry.
  if (item?.kind === "namespaces") {
    return <NamespaceDrawer open={open} onClose={onClose} token={token} namespaceName={name} onNavigate={onNavigate} />;
  }
  if (item?.kind === "helmreleases") {
    return <HelmReleaseDrawer open={open} onClose={onClose} token={token} namespace={namespace} releaseName={name} />;
  }

  return (
    <ResourceIdentityDrawer
      token={token}
      identity={item ? { resource: item.kind, namespace, name: item.name } : null}
      open={open}
      onClose={onClose}
    />
  );
}
