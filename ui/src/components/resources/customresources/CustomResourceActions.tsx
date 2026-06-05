import React from "react";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";

type Props = {
  token: string;
  namespace: string;
  name: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  onDeleted: () => void;
};

export default function CustomResourceActions({
  token,
  namespace,
  name,
  group,
  version,
  resource,
  kind,
  onDeleted,
}: Props) {
  const apiVersion = group ? `${group}/${version}` : version;

  return (
    <DeleteOnlyActions
      token={token}
      namespace={namespace}
      name={name}
      onDeleted={onDeleted}
      config={{
        group,
        resource,
        kind,
        apiVersion,
        deleteId: "customresource.delete",
        deleteTitle: `Delete ${kind}`,
        deleteDescription:
          "Permanently removes this custom resource instance. Controllers and finalizers may continue cleanup after the delete request is accepted.",
      }}
    />
  );
}
