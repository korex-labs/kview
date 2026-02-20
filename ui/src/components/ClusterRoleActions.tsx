import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  clusterRoleName: string;
  onDeleted: () => void;
};

export default function ClusterRoleActions({ token, clusterRoleName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "rbac.authorization.k8s.io",
    resource: "clusterroles",
    namespace: "",
    name: clusterRoleName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "ClusterRole",
    name: clusterRoleName,
    namespace: "",
    apiVersion: "rbac.authorization.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "clusterrole.delete",
          title: "Delete ClusterRole",
          description: "Permanently removes the ClusterRole. ClusterRoleBindings referencing this role will become dangling.",
          group: "rbac.authorization.k8s.io",
          resource: "clusterroles",
          requiredValue: clusterRoleName,
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
