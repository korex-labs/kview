import React from "react";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";

type Props = {
  token: string;
  namespace: string;
  limitRangeName: string;
  onDeleted: () => void;
};

export default function LimitRangeActions({ token, namespace, limitRangeName, onDeleted }: Props) {
  return (
    <DeleteOnlyActions
      token={token}
      namespace={namespace}
      name={limitRangeName}
      onDeleted={onDeleted}
      config={{
        group: "",
        resource: "limitranges",
        kind: "LimitRange",
        apiVersion: "v1",
        deleteId: "limitrange.delete",
        deleteTitle: "Delete LimitRange",
        deleteDescription:
          "Permanently removes the limit range. Default, minimum, and maximum resource constraints from this object will no longer apply.",
      }}
    />
  );
}
