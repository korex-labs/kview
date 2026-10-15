import type { ApiDataplaneSearchItem } from "../../types/api";
import React, { lazy, Suspense } from "react";
import ResourceIdentityDrawer from "../shared/ResourceIdentityDrawer";

const HelmReleaseDrawer = lazy(() => import("../resources/helm/HelmReleaseDrawer"));
const NamespaceDrawer = lazy(() => import("../resources/namespaces/NamespaceDrawer"));

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
    return <Suspense fallback={null}><NamespaceDrawer open={open} onClose={onClose} token={token} namespaceName={name} onNavigate={onNavigate} /></Suspense>;
  }
  if (item?.kind === "helmreleases") {
    return <Suspense fallback={null}><HelmReleaseDrawer open={open} onClose={onClose} token={token} namespace={namespace} releaseName={name} /></Suspense>;
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
