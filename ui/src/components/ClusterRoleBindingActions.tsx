import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  clusterRoleBindingName: string;
  onDeleted: () => void;
};

export default function ClusterRoleBindingActions({ token, clusterRoleBindingName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "rbac.authorization.k8s.io",
    resource: "clusterrolebindings",
    namespace: "",
    name: clusterRoleBindingName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "ClusterRoleBinding",
    name: clusterRoleBindingName,
    namespace: "",
    apiVersion: "rbac.authorization.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "clusterrolebinding.delete",
          title: "Delete ClusterRoleBinding",
          description: "Permanently removes the ClusterRoleBinding. Subjects will lose all cluster-wide permissions granted by this binding.",
          group: "rbac.authorization.k8s.io",
          resource: "clusterrolebindings",
          requiredValue: clusterRoleBindingName,
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
