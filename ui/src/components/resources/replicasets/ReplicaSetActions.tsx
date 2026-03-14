import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import {
  useResourceCapabilities,
  canPatchOrUpdate,
  RBAC_DISABLED_REASON,
} from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor, buildScaleDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  replicaSetName: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function ReplicaSetActions({
  token,
  namespace,
  replicaSetName,
  currentReplicas,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "apps",
    resource: "replicasets",
    namespace,
    name: replicaSetName,
  });

  const canScale = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "ReplicaSet",
    name: replicaSetName,
    namespace,
    apiVersion: "apps/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Scale"
        descriptor={buildScaleDescriptor({
          id: "replicaset.scale",
          title: "Scale ReplicaSet",
          description: "Set the desired number of replicas.",
          group: "apps",
          resource: "replicasets",
          defaultReplicas: currentReplicas,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canScale}
        disabledReason={!canScale && caps ? RBAC_DISABLED_REASON : ""}
        initialParams={{ replicas: String(currentReplicas) }}
        onSuccess={onRefresh}
      />

      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "replicaset.delete",
          title: "Delete ReplicaSet",
          description: "Permanently removes the replicaset and its pods.",
          group: "apps",
          resource: "replicasets",
          requiredValue: replicaSetName,
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
