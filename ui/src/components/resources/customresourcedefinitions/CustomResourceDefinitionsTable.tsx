import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { workloadHealthBucketColor } from "../../../utils/k8sUi";
import CustomResourceDefinitionDrawer from "./CustomResourceDefinitionDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type CRDItem = {
  name: string;
  group?: string;
  scope?: string;
  kind?: string;
  versions?: string;
  established?: boolean;
  ageSec: number;
  healthBucket?: string;
  versionBreadth?: string;
  needsAttention?: boolean;
};

type Row = CRDItem & { id: string };

const resourceLabel = getResourceLabel("customresourcedefinitions");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 300 },
  {
    field: "healthBucket",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const bucket = p.row.healthBucket || "unknown";
      return <Chip size="small" label={p.row.needsAttention ? "attention" : bucket} color={workloadHealthBucketColor(bucket)} />;
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: CRDItem[] }>("/api/customresourcedefinitions", token);
    const items = res.items || [];
    return { rows: items.map((c) => ({ ...c, id: c.name })) };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.group || "").toLowerCase().includes(q) ||
      (row.kind || "").toLowerCase().includes(q) ||
      (row.scope || "").toLowerCase().includes(q) ||
      (row.healthBucket || "").toLowerCase().includes(q) ||
      (row.versionBreadth || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/group/kind/scope/signal)"
      resourceLabel={resourceLabel}
      resourceKey="customresourcedefinitions"
      accessResource={listResourceAccess.customresourcedefinitions}
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
