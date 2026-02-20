import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  namespaceName: string;
  onDeleted: () => void;
};

export default function NamespaceActions({ token, namespaceName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "namespaces",
    namespace: "",
    name: namespaceName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Namespace",
    name: namespaceName,
    namespace: "",
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "namespaces.delete",
          title: "Delete Namespace",
          description: "Permanently removes the Namespace and all resources within it. This is irreversible.",
          group: "",
          resource: "namespaces",
          requiredValue: namespaceName,
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
