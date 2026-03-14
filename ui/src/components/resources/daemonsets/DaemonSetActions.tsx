import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import {
  useResourceCapabilities,
  canPatchOrUpdate,
  RBAC_DISABLED_REASON,
} from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor, buildRestartDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  daemonSetName: string;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function DaemonSetActions({
  token,
  namespace,
  daemonSetName,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "apps",
    resource: "daemonsets",
    namespace,
    name: daemonSetName,
  });

  const canRestart = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "DaemonSet",
    name: daemonSetName,
    namespace,
    apiVersion: "apps/v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Restart"
        descriptor={buildRestartDescriptor({
          id: "daemonset.restart",
          title: "Restart DaemonSet",
          description: "Performs a rolling restart by patching the pod template annotation.",
          group: "apps",
          resource: "daemonsets",
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
          id: "daemonset.delete",
          title: "Delete DaemonSet",
          description: "Permanently removes the daemonset and its pods.",
          group: "apps",
          resource: "daemonsets",
          requiredValue: daemonSetName,
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
