import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import {
  useResourceCapabilities,
  canPatchOrUpdate,
  RBAC_DISABLED_REASON,
} from "../../mutations/useResourceCapabilities";
import {
  buildDeleteDescriptor,
  buildRestartDescriptor,
  buildScaleDescriptor,
} from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  statefulSetName: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function StatefulSetActions({
  token,
  namespace,
  statefulSetName,
  currentReplicas,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "apps",
    resource: "statefulsets",
    namespace,
    name: statefulSetName,
  });

  const canScale = canPatchOrUpdate(caps);
  const canRestart = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "StatefulSet",
    name: statefulSetName,
    namespace,
    apiVersion: "apps/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Scale"
        descriptor={buildScaleDescriptor({
          id: "statefulset.scale",
          title: "Scale StatefulSet",
          description: "Set the desired number of replicas.",
          group: "apps",
          resource: "statefulsets",
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
        label="Restart"
        descriptor={buildRestartDescriptor({
          id: "statefulset.restart",
          title: "Restart StatefulSet",
          description: "Performs a rolling restart by patching the pod template annotation.",
          group: "apps",
          resource: "statefulsets",
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canRestart}
        disabledReason={!canRestart && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onRefresh}
      />

      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "statefulset.delete",
          title: "Delete StatefulSet",
          description: "Permanently removes the statefulset and its pods.",
          group: "apps",
          resource: "statefulsets",
          requiredValue: statefulSetName,
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
