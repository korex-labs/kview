import React, { useCallback, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge } from "../../../utils/format";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import ListSignalChip from "../../shared/ListSignalChip";
import CustomResourceDrawer, { type CRRef } from "./CustomResourceDrawer";
import type { ResourceListFetchResult } from "../../../types/api";

type CRInstanceItem = {
  name: string;
  namespace?: string;
  kind: string;
  group: string;
  version: string;
  resource: string;
  ageSec: number;
  signalSeverity?: string;
  statusSummary?: string;
};

type AggregationMeta = {
  totalKinds: number;
  accessibleKinds: number;
  deniedKinds: number;
  errorKinds: number;
};

type Row = CRInstanceItem & { id: string };

const resourceLabel = getResourceLabel("customresources");

const columns: GridColDef<Row>[] = [
  {
    field: "kind",
    headerName: "Kind",
    width: 180,
    renderCell: (p) => (
      <Chip size="small" label={p.value as string} variant="outlined" />
    ),
  },
  { field: "name", headerName: "Name", flex: 1, minWidth: 220 },
  {
    field: "signalSeverity",
    headerName: "Status",
    width: 150,
    renderCell: (p) => (
      <Box sx={{ display: "flex", alignItems: "center", height: "100%", gap: 0.5 }}>
        <ListSignalChip severity={p.row.signalSeverity} />
        {p.row.statusSummary && p.row.signalSeverity !== "ok" && (
          <Typography variant="caption" color="text.secondary">
            {p.row.statusSummary}
          </Typography>
        )}
      </Box>
    ),
  },
  {
    field: "group",
    headerName: "Group",
    width: 200,
    renderCell: (p) => (
      <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
        {(p.value as string) || "-"}
      </Typography>
    ),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 110,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function CustomResourcesTable({ token, namespace }: { token: string; namespace: string }) {
  const [aggMeta, setAggMeta] = useState<AggregationMeta | null>(null);

  const fetchRows = useCallback(async (contextName?: string): Promise<ResourceListFetchResult<Row>> => {
    const res = await apiGetWithContext<{ items?: CRInstanceItem[]; meta?: AggregationMeta }>(
      `/api/namespaces/${encodeURIComponent(namespace)}/customresources`,
      token,
      contextName || "",
    );
    const items = res.items || [];
    setAggMeta(res.meta ?? null);
    return {
      rows: items.map((c) => ({ ...c, id: `${c.group}/${c.kind}/${c.namespace || ""}/${c.name}` })),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      row.kind.toLowerCase().includes(q) ||
      (row.group || "").toLowerCase().includes(q) ||
      (row.signalSeverity || "").toLowerCase().includes(q) ||
      (row.statusSummary || "").toLowerCase().includes(q),
    [],
  );

  const metaPrefix = aggMeta ? (
    <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
      {aggMeta.accessibleKinds} accessible kind{aggMeta.accessibleKinds !== 1 ? "s" : ""}
      {aggMeta.deniedKinds > 0 ? ` · ${aggMeta.deniedKinds} access denied` : ""}
      {aggMeta.errorKinds > 0 ? ` · ${aggMeta.errorKinds} error` : ""}
    </Typography>
  ) : null;

  return (
    <ResourceListPage<Row>
      token={token}
      title={`${resourceLabel} · ${namespace}`}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/kind/group/status)"
      resourceLabel={resourceLabel}
      resourceKey="customresources"
      accessResource={listResourceAccess.customresources}
      namespace={namespace}
      defaultSortField="kind"
      skipEmptyAccessCheck
      dataplaneMetaPrefix={metaPrefix}
      renderDrawer={({ selectedRow, open, onClose }) => {
        const crRef: CRRef | null = selectedRow
          ? {
              group: selectedRow.group,
              version: selectedRow.version,
              resource: selectedRow.resource,
              kind: selectedRow.kind,
              namespace: selectedRow.namespace || namespace,
              name: selectedRow.name,
            }
          : null;
        return (
          <CustomResourceDrawer
            open={open}
            onClose={onClose}
            token={token}
            crRef={crRef}
          />
        );
      }}
    />
  );
}
