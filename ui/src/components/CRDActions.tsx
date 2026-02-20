import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  crdName: string;
  onDeleted: () => void;
};

export default function CRDActions({ token, crdName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "apiextensions.k8s.io",
    resource: "customresourcedefinitions",
    namespace: "",
    name: crdName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "CustomResourceDefinition",
    name: crdName,
    namespace: "",
    apiVersion: "apiextensions.k8s.io/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "customresourcedefinitions.delete",
          title: "Delete CustomResourceDefinition",
          description: "Permanently removes the CRD and all associated custom resources. This is irreversible.",
          group: "apiextensions.k8s.io",
          resource: "customresourcedefinitions",
          requiredValue: crdName,
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
