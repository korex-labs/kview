import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  ingressName: string;
  onDeleted: () => void;
};

export default function IngressActions({ token, namespace, ingressName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "networking.k8s.io",
    resource: "ingresses",
    namespace,
    name: ingressName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Ingress",
    name: ingressName,
    namespace,
    apiVersion: "networking.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "ingress.delete",
          title: "Delete Ingress",
          description: "Permanently removes the ingress. Traffic routing rules for the associated hosts will be lost.",
          group: "networking.k8s.io",
          resource: "ingresses",
          requiredValue: ingressName,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}
