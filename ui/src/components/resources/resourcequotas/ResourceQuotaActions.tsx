import React from "react";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";

type Props = {
  token: string;
  namespace: string;
  resourceQuotaName: string;
  onDeleted: () => void;
};

export default function ResourceQuotaActions({ token, namespace, resourceQuotaName, onDeleted }: Props) {
  return (
    <DeleteOnlyActions
      token={token}
      namespace={namespace}
      name={resourceQuotaName}
      onDeleted={onDeleted}
      config={{
        group: "",
        resource: "resourcequotas",
        kind: "ResourceQuota",
        apiVersion: "v1",
        deleteId: "resourcequota.delete",
        deleteTitle: "Delete ResourceQuota",
        deleteDescription:
          "Permanently removes the quota. Namespace resource usage will no longer be constrained by this quota.",
      }}
    />
  );
}
