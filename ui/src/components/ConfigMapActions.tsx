import React, { useEffect, useState } from "react";
import { Box } from "@mui/material";
import { apiPostWithContext } from "../api";
import { useActiveContext } from "../activeContext";
import ActionButton from "./mutations/ActionButton";

type Capabilities = {
  delete: boolean;
  update: boolean;
  patch: boolean;
  create: boolean;
};

type Props = {
  token: string;
  namespace: string;
  configMapName: string;
  onDeleted: () => void;
};

export default function ConfigMapActions({ token, namespace, configMapName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    if (!activeContext || !configMapName) return;
    setCaps(null);
    apiPostWithContext<{ capabilities: Capabilities }>(
      "/api/capabilities",
      token,
      activeContext,
      { group: "", resource: "configmaps", namespace, name: configMapName },
    )
      .then((res) => setCaps(res.capabilities))
      .catch(() => setCaps({ delete: false, update: false, patch: false, create: false }));
  }, [activeContext, token, namespace, configMapName]);

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
        descriptor={{
          id: "configmap.delete",
          title: "Delete ConfigMap",
          description: "Permanently removes the ConfigMap. Workloads mounting this ConfigMap will fail on next restart.",
          risk: "high",
          confirmSpec: { mode: "typed", requiredValue: configMapName },
          group: "",
          resource: "configmaps",
        }}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? "Not permitted by RBAC" : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}
