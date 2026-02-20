import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "./mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../lib/actions/builders";

type Props = {
  token: string;
  nodeName: string;
  onDeleted: () => void;
};

export default function NodeActions({ token, nodeName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "nodes",
    namespace: "",
    name: nodeName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Node",
    name: nodeName,
    namespace: "",
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "nodes.delete",
          title: "Delete Node",
          description: "Permanently removes the Node from the cluster. Running pods will be rescheduled to other nodes.",
          group: "",
          resource: "nodes",
          requiredValue: nodeName,
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
