import React, { useCallback } from "react";
import { Box } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import type { ApiDataplaneListResponse, NamespaceResourceQuota } from "../../../types/api";
import { dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import GaugeBar from "../../shared/GaugeBar";
import ResourceListPage from "../../shared/ResourceListPage";
import ResourceQuotaDrawer from "./ResourceQuotaDrawer";

type Row = NamespaceResourceQuota & {
  id: string;
  entryCount: number;
  maxRatio?: number;
  maxEntry?: string;
};

function maxEntry(row: NamespaceResourceQuota): { ratio?: number; key?: string } {
  return (row.entries || []).reduce<{ ratio?: number; key?: string }>((best, entry) => {
    if (entry.ratio == null) return best;
    if (best.ratio == null || entry.ratio > best.ratio) return { ratio: entry.ratio, key: entry.key };
    return best;
  }, {});
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "entryCount",
    headerName: "Entries",
    width: 110,
    type: "number",
    renderCell: (p) => valueOrDash(p.value as number | undefined),
  },
  {
    field: "maxRatio",
    headerName: "Highest usage",
    width: 180,
    type: "number",
    renderCell: (p) => {
      const ratio = p.row.maxRatio;
      if (ratio == null) return "-";
      const pct = Math.round(ratio * 100);
      return (
        <Box sx={{ display: "flex", alignItems: "center", width: "100%", height: "100%" }}>
          <Box sx={{ width: "100%" }}>
            <GaugeBar value={pct} tone={ratio >= 0.95 ? "error" : ratio >= 0.8 ? "warning" : "success"} />
          </Box>
        </Box>
      );
    },
  },
  { field: "maxEntry", headerName: "Pressure key", flex: 1, minWidth: 180, renderCell: (p) => valueOrDash(p.value as string | undefined) },
  { field: "ageSec", headerName: "Age", width: 130, type: "number", renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table") },
];

export default function ResourceQuotasTable({ token, namespace }: { token: string; namespace: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<NamespaceResourceQuota>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/resourcequotas`,
      token,
      contextName || "",
    );
    return {
      rows: (res.items || []).map((quota) => {
        const max = maxEntry(quota);
        return {
          ...quota,
          id: `${quota.namespace}/${quota.name}`,
          entryCount: quota.entries?.length || 0,
          maxRatio: max.ratio,
          maxEntry: max.key,
        };
      }),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [namespace, token]);

  return (
    <ResourceListPage<Row>
      token={token}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{ fetchRevision: dataplaneRevisionFetcher(token, "resourcequotas", namespace), pollSec: defaultRevisionPollSec }}
      enabled={!!namespace}
      resourceKey="resourcequotas"
      namespace={namespace}
      renderDrawer={({ selectedRow, open, onClose }) => (
        <ResourceQuotaDrawer
          open={open}
          onClose={onClose}
          token={token}
          namespace={namespace}
          resourceQuotaName={selectedRow?.name || null}
        />
      )}
    />
  );
}
