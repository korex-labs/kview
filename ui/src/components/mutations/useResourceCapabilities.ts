import { useState, useEffect } from "react";
import { apiPostWithContext } from "../../api";
import { useActiveContext } from "../../activeContext";
import { useConnectionState } from "../../connectionState";

export type Capabilities = {
  delete: boolean;
  update: boolean;
  patch: boolean;
  create: boolean;
};

type CapabilityState = {
  targetKey: string;
  capabilities: Capabilities | null;
};

export const RBAC_DISABLED_REASON = "Not permitted by RBAC";

export function canPatchOrUpdate(caps: Capabilities | null): boolean {
  return caps ? caps.patch || caps.update : false;
}

const CAPS_DENIED: Capabilities = { delete: false, update: false, patch: false, create: false };

function capabilityTargetKey(parts: {
  context: string;
  token: string;
  group: string;
  resource: string;
  namespace: string;
  name: string;
}): string {
  return JSON.stringify(parts);
}

/**
 * Fetches RBAC capabilities for a specific Kubernetes resource.
 *
 * Returns null while loading or when activeContext / name are not yet available.
 * Returns CAPS_DENIED on fetch failure (same as per-component fallback behavior).
 * Results are keyed to the complete request target so a previous or late request
 * can never authorize a different resource during drawer transitions.
 */
export function useResourceCapabilities({
  token,
  group,
  resource,
  namespace,
  name,
}: {
  token: string;
  group: string;
  resource: string;
  namespace: string;
  name: string;
}): Capabilities | null {
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const targetKey = capabilityTargetKey({
    context: activeContext,
    token,
    group,
    resource,
    namespace,
    name,
  });
  const [state, setState] = useState<CapabilityState>({ targetKey, capabilities: null });

  useEffect(() => {
    let current = true;
    setState({ targetKey, capabilities: null });
    if (!activeContext || !name) return () => { current = false; };
    if (health === "unhealthy") {
      setState({ targetKey, capabilities: CAPS_DENIED });
      return () => { current = false; };
    }
    apiPostWithContext<{ capabilities: Capabilities }>(
      "/api/capabilities",
      token,
      activeContext,
      { group, resource, namespace, name },
    )
      .then((res) => {
        if (current) setState({ targetKey, capabilities: res.capabilities });
      })
      .catch(() => {
        if (current) setState({ targetKey, capabilities: CAPS_DENIED });
      });
    return () => { current = false; };
  }, [activeContext, token, namespace, name, group, resource, health, targetKey]);

  return state.targetKey === targetKey ? state.capabilities : null;
}
