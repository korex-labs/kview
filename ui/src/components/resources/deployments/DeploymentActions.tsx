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
  deploymentName: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function DeploymentActions({
  token,
  namespace,
  deploymentName,
  currentReplicas,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "apps",
    resource: "deployments",
    namespace,
    name: deploymentName,
  });

  const canScale = canPatchOrUpdate(caps);
  const canRestart = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Deployment",
    name: deploymentName,
    namespace,
    apiVersion: "apps/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Scale"
        descriptor={buildScaleDescriptor({
          id: "scale",
          title: "Scale Deployment",
          description: "Set the desired number of replicas.",
          group: "apps",
          resource: "deployments",
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
          id: "restart",
          title: "Restart Deployment",
          description: "Performs a rolling restart by patching the pod template annotation.",
          group: "apps",
          resource: "deployments",
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
          id: "delete",
          title: "Delete Deployment",
          description: "Permanently removes the deployment and its pods.",
          group: "apps",
          resource: "deployments",
          requiredValue: deploymentName,
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
