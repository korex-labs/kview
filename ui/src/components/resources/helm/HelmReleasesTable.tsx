import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtTs, valueOrDash } from "../../../utils/format";
import HelmReleaseDrawer from "./HelmReleaseDrawer";
import { HelmInstallButton } from "./HelmActions";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import {
  dataplaneListMetaFromResponse,
  type ApiDataplaneListResponse,
} from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";

type HelmRelease = {
  name: string;
  namespace: string;
  status: string;
  revision: number;
  chart: string;
  chartName: string;
  chartVersion: string;
  appVersion: string;
  description: string;
  updated: number;
  storageBackend: string;
};

type Row = HelmRelease & { id: string };

type ChipColor = "success" | "warning" | "error" | "default";

function helmStatusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "deployed":
      return "success";
    case "superseded":
      return "default";
    case "failed":
      return "error";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
    case "uninstalling":
    case "unknown":
      return "warning";
    default:
      return "default";
  }
}

const resourceLabel = getResourceLabel("helm");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 200 },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => (
      <Chip
        size="small"
        label={valueOrDash(p.value as string | undefined)}
        color={helmStatusChipColor(p.value as string | undefined)}
      />
    ),
  },
  {
    field: "revision",
    headerName: "Revision",
    width: 90,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "chart",
    headerName: "Chart",
    width: 220,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "appVersion",
    headerName: "App Version",
    width: 130,
    renderCell: (p) => valueOrDash(p.value as string | undefined),
  },
  {
    field: "updated",
    headerName: "Updated",
    width: 180,
    renderCell: (p) => fmtTs(p.value as number | undefined),
  },
];

export default function HelmReleasesTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<HelmRelease>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/helmreleases`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((r) => ({ ...r, id: `${r.namespace}/${r.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      row.chart.toLowerCase().includes(q) ||
      (row.appVersion || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "helmreleases", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name / chart / version)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.helm}
      namespace={namespace}
      renderFooterExtra={(refetch) => (
        <HelmInstallButton
          token={token}
          namespace={namespace}
          onSuccess={() => void refetch()}
        />
      )}
      renderDrawer={({ selectedId, open, onClose, refetch }) => {
        const releaseName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <HelmReleaseDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            releaseName={releaseName}
            onRefresh={() => void refetch()}
          />
        );
      }}
    />
  );
}
