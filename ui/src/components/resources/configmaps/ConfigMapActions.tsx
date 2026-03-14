import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  configMapName: string;
  onDeleted: () => void;
};

export default function ConfigMapActions({ token, namespace, configMapName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "configmaps",
    namespace,
    name: configMapName,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "ConfigMap",
    name: configMapName,
    namespace,
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: "configmap.delete",
          title: "Delete ConfigMap",
          description: "Permanently removes the ConfigMap. Workloads mounting this ConfigMap will fail on next restart.",
          group: "",
          resource: "configmaps",
          requiredValue: configMapName,
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
