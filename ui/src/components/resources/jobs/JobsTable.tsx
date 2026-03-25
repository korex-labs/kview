import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import JobDrawer from "./JobDrawer";
import { fmtAge } from "../../../utils/format";
import { jobStatusChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Job = {
  name: string;
  namespace: string;
  active: number;
  succeeded: number;
  failed: number;
  durationSec?: number;
  ageSec: number;
  status?: string;
};

type Row = Job & { id: string };

const resourceLabel = getResourceLabel("jobs");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "status",
    headerName: "Status",
    width: 140,
    renderCell: (p) => {
      const status = String(p.value || "");
      return <Chip size="small" label={status || "-"} color={jobStatusChipColor(status)} />;
    },
  },
  { field: "active", headerName: "Active", width: 110, type: "number" },
  { field: "succeeded", headerName: "Succeeded", width: 120, type: "number" },
  { field: "failed", headerName: "Failed", width: 110, type: "number" },
  {
    field: "durationSec",
    headerName: "Duration",
    width: 130,
    type: "number",
    renderCell: (p) => {
      const val = Number(p.row?.durationSec);
      return val > 0 ? fmtAge(val, "table") : "-";
    },
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function JobsTable({ token, namespace }: { token: string; namespace: string }) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<Job>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/jobs`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((j) => ({ ...j, id: `${j.namespace}/${j.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) || (row.status || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/status)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.jobs}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const jobName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <JobDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            jobName={jobName}
          />
        );
      }}
    />
  );
}
