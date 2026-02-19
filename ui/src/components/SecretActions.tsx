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
  secretName: string;
  onDeleted: () => void;
};

export default function SecretActions({ token, namespace, secretName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    if (!activeContext || !secretName) return;
    setCaps(null);
    apiPostWithContext<{ capabilities: Capabilities }>(
      "/api/capabilities",
      token,
      activeContext,
      { group: "", resource: "secrets", namespace, name: secretName },
    )
      .then((res) => setCaps(res.capabilities))
      .catch(() => setCaps({ delete: false, update: false, patch: false, create: false }));
  }, [activeContext, token, namespace, secretName]);

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: "Secret",
    name: secretName,
    namespace,
    apiVersion: "v1",
  };

  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={{
          id: "secret.delete",
          title: "Delete Secret",
          description: "Permanently removes the Secret. Workloads referencing this Secret will fail on next restart.",
          risk: "high",
          confirmSpec: { mode: "typed", requiredValue: secretName },
          group: "",
          resource: "secrets",
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
