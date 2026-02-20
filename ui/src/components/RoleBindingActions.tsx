import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  roleBindingName: string;
  onDeleted: () => void;
};

export default function RoleBindingActions({ token, namespace, roleBindingName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "rbac.authorization.k8s.io",
    resource: "rolebindings",
    namespace,
    name: roleBindingName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "RoleBinding",
    name: roleBindingName,
    namespace,
    apiVersion: "rbac.authorization.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "rolebinding.delete",
          title: "Delete RoleBinding",
          description: "Permanently removes the RoleBinding. Subjects will lose the permissions granted by this binding.",
          group: "rbac.authorization.k8s.io",
          resource: "rolebindings",
          requiredValue: roleBindingName,
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
