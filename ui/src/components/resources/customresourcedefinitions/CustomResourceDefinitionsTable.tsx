import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import CustomResourceDefinitionDrawer from "./CustomResourceDefinitionDrawer";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneListMetaFromResponse, type ApiDataplaneListResponse } from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";

type CRDItem = {
  name: string;
  group?: string;
  scope?: string;
  kind?: string;
  versions?: string;
  established?: boolean;
  ageSec: number;
  versionBreadth?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = CRDItem & { id: string };

const resourceLabel = getResourceLabel("customresourcedefinitions");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 300 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
    },
  },
  {
    field: "group",
    headerName: "Group",
    width: 220,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "scope",
    headerName: "Scope",
    width: 130,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "kind",
    headerName: "Kind",
    width: 180,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "versions",
    headerName: "Versions",
    width: 280,
    renderCell: (p) => (
      <Chip
        size="small"
        label={`${p.row.versionBreadth || "unknown"} · ${valueOrDash(String(p.value || ""))}`}
        color={p.row.versionBreadth === "multi" ? "primary" : "default"}
        variant="outlined"
      />
    ),
  },
  {
    field: "established",
    headerName: "Established",
    width: 120,
    renderCell: (p) => (
      <Chip
        size="small"
        label={p.value ? "Yes" : "No"}
        color={p.value ? "success" : "warning"}
      />
    ),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function CustomResourceDefinitionsTable({ token }: { token: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<CRDItem>>("/api/customresourcedefinitions", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((c) => ({ ...c, id: c.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.group || "").toLowerCase().includes(q) ||
      (row.kind || "").toLowerCase().includes(q) ||
      (row.scope || "").toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q) ||
      (row.versionBreadth || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "customresourcedefinitions"),
        pollSec: defaultRevisionPollSec,
      }}
      filterPredicate={filterPredicate}
      resourceLabel={resourceLabel}
      resourceKey="customresourcedefinitions"
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <CustomResourceDefinitionDrawer
          open={open}
          onClose={onClose}
          token={token}
          crdName={selectedId}
        />
      )}
    />
  );
}
