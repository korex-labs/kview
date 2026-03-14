import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  pvName: string;
  onDeleted: () => void;
};

export default function PVActions({ token, pvName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "persistentvolumes",
    namespace: "",
    name: pvName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "PersistentVolume",
    name: pvName,
    namespace: "",
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "persistentvolumes.delete",
          title: "Delete PersistentVolume",
          description: "Permanently removes the PersistentVolume. Bound PVCs will lose their backing storage.",
          group: "",
          resource: "persistentvolumes",
          requiredValue: pvName,
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
