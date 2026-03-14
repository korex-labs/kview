import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  podName: string;
  onDeleted: () => void;
};

export default function PodActions({ token, namespace, podName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "pods",
    namespace,
    name: podName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Pod",
    name: podName,
    namespace,
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "pod.delete",
          title: "Delete Pod",
          description: "Permanently removes the pod. A new pod may be created by the owner controller.",
          group: "",
          resource: "pods",
          requiredValue: podName,
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
