import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  pvcName: string;
  onDeleted: () => void;
};

export default function PVCActions({ token, namespace, pvcName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "persistentvolumeclaims",
    namespace,
    name: pvcName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "PersistentVolumeClaim",
    name: pvcName,
    namespace,
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "persistentvolumeclaims.delete",
          title: "Delete PersistentVolumeClaim",
          description: "Permanently removes the PersistentVolumeClaim. Pods using this PVC will lose access to the volume.",
          group: "",
          resource: "persistentvolumeclaims",
          requiredValue: pvcName,
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
