import React from "react";
import { Box } from "@mui/material";
import { useActiveContext } from "../../../activeContext";
import ActionButton from "../../mutations/ActionButton";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import { buildDeleteDescriptor } from "../../../lib/actions/builders";

type Props = {
  token: string;
  namespace: string;
  secretName: string;
  onDeleted: () => void;
};

export default function SecretActions({ token, namespace, secretName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: "",
    resource: "secrets",
    namespace,
    name: secretName,
  });

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
        descriptor={buildDeleteDescriptor({
          id: "secret.delete",
          title: "Delete Secret",
          description: "Permanently removes the Secret. Workloads referencing this Secret will fail on next restart.",
          group: "",
          resource: "secrets",
          requiredValue: secretName,
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
