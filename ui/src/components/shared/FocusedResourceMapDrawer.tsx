import React from "react";
import type { ApiResourceIdentity } from "../../types/api";
import type { ListResourceKey } from "../../utils/k8sResources";
import RightDrawer from "../layout/RightDrawer";
import ResourceDrawerShell from "./ResourceDrawerShell";
import { resourceIdentityKey } from "./resourceMapIdentity";
import { useActiveContext } from "../../activeContext";

/** Identity-only entry: opening a cached map must not mount a live detail reader. */
export default function FocusedResourceMapDrawer({ token, identity, open, onClose }: {
  token: string; identity: ApiResourceIdentity; open: boolean; onClose: () => void;
}) {
  const context = useActiveContext();
  return <RightDrawer open={open} onClose={onClose}>
    <ResourceDrawerShell
      key={`${context}|${resourceIdentityKey(identity)}`}
      title={`${identity.kind}: ${identity.name}`}
      token={token}
      resourceIdentity={{ ...identity, resource: identity.resource as ListResourceKey, apiResource: identity.resource, scope: identity.scope === "unknown" ? undefined : identity.scope }}
      initialAuxiliaryTab="resource-map"
      onClose={onClose}
    >{null}</ResourceDrawerShell>
  </RightDrawer>;
}
