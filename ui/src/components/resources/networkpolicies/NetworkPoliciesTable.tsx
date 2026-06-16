import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import type { ApiDataplaneListResponse, NetworkPolicy } from "../../../types/api";
import { dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import NetworkPolicyDrawer from "./NetworkPolicyDrawer";

type Row = NetworkPolicy & { id: string };

const resourceLabel = getResourceLabel("networkpolicies");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  { field: "podSelector", headerName: "Pod selector", flex: 1, minWidth: 220, renderCell: (p) => valueOrDash(p.value as string | undefined) },
  {
    field: "policyTypes",
    headerName: "Types",
    width: 180,
    renderCell: (p) => (
      <>
        {(p.row.policyTypes || []).map((type) => <Chip key={type} size="small" label={type} sx={{ mr: 0.5 }} />)}
      </>
    ),
    sortable: false,
  },
  { field: "ingressRules", headerName: "Ingress", width: 110, type: "number" },
  { field: "egressRules", headerName: "Egress", width: 110, type: "number" },
  { field: "selectedPods", headerName: "Pods", width: 110, type: "number", renderCell: (p) => valueOrDash(p.value as number | undefined) },
  { field: "ageSec", headerName: "Age", width: 130, type: "number", renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table") },
];

export default function NetworkPoliciesTable({ token, namespace }: { token: string; namespace: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<NetworkPolicy>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/networkpolicies`,
      token,
      contextName || "",
    );
    return {
      rows: (res.items || []).map((item) => ({ ...item, id: `${item.namespace}/${item.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [namespace, token]);

  const filterPredicate = useCallback((row: Row, q: string) => (
    row.name.toLowerCase().includes(q) ||
    (row.podSelector || "").toLowerCase().includes(q) ||
    (row.policyTypes || []).some((type) => type.toLowerCase().includes(q))
  ), []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{ fetchRevision: dataplaneRevisionFetcher(token, "networkpolicies", namespace), pollSec: defaultRevisionPollSec }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      resourceLabel={resourceLabel}
      resourceKey="networkpolicies"
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const networkPolicyName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <NetworkPolicyDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            networkPolicyName={networkPolicyName}
          />
        );
      }}
    />
  );
}
