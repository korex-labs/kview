import React from "react";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";

type Props = {
  token: string;
  namespace: string;
  networkPolicyName: string;
  onDeleted: () => void;
};

export default function NetworkPolicyActions({ token, namespace, networkPolicyName, onDeleted }: Props) {
  return (
    <DeleteOnlyActions
      token={token}
      namespace={namespace}
      name={networkPolicyName}
      onDeleted={onDeleted}
      config={{
        group: "networking.k8s.io",
        resource: "networkpolicies",
        kind: "NetworkPolicy",
        apiVersion: "networking.k8s.io/v1",
        deleteId: "networkpolicy.delete",
        deleteTitle: "Delete NetworkPolicy",
        deleteDescription:
          "Permanently removes the network policy. Pod ingress or egress isolation may change immediately.",
      }}
    />
  );
}
