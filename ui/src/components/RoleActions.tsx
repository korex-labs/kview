import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  roleName: string;
  onDeleted: () => void;
};

export default function RoleActions({ token, namespace, roleName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "rbac.authorization.k8s.io",
    resource: "roles",
    namespace,
    name: roleName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Role",
    name: roleName,
    namespace,
    apiVersion: "rbac.authorization.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "role.delete",
          title: "Delete Role",
          description: "Permanently removes the Role. RoleBindings referencing this Role will become dangling.",
          group: "rbac.authorization.k8s.io",
          resource: "roles",
          requiredValue: roleName,
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
