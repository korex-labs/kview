import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import ServiceAccountDrawer from "./ServiceAccountDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type ServiceAccount = {
  name: string;
  namespace: string;
  imagePullSecretsCount: number;
  secretsCount: number;
  automountServiceAccountToken?: boolean;
  ageSec: number;
};

type Row = ServiceAccount & { id: string };

const resourceLabel = getResourceLabel("serviceaccounts");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "imagePullSecretsCount",
    headerName: "ImagePullSecrets",
    width: 160,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "secretsCount",
    headerName: "Secrets",
    width: 120,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function ServiceAccountsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<ServiceAccount>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/serviceaccounts`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((sa) => ({ ...sa, id: `${sa.namespace}/${sa.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) => row.name.toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "serviceaccounts", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.serviceaccounts}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const serviceAccountName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <ServiceAccountDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            serviceAccountName={serviceAccountName}
          />
        );
      }}
    />
  );
}
