import React, { useCallback, useMemo, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiNamespacesListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import NamespaceDrawer from "./NamespaceDrawer";
import { fmtAge } from "../../../utils/format";
import { namespacePhaseChipColor, namespaceRowSummaryStateColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type Namespace = NonNullable<ApiNamespacesListResponse["items"]>[number];

type Row = Namespace & { id: string };

const resourceLabel = getResourceLabel("namespaces");

function dashNum(row: Row, key: "podCount" | "deploymentCount" | "problematicCount" | "podsWithRestarts"): string {
  if (!row.rowEnriched) return "—";
  const v = row[key];
  if (v === undefined || v === null) return "—";
  return String(v);
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 200 },
  {
    field: "phase",
    headerName: "Phase",
    width: 170,
    renderCell: (p) => {
      const phase = String(p.value || "");
      const row = p.row;
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Chip size="small" label={phase || "-"} color={namespacePhaseChipColor(phase)} />
          {row.hasUnhealthyConditions && (
            <Chip size="small" color="error" label="Unhealthy" />
          )}
        </Box>
      );
    },
  },
  {
    field: "summaryState",
    headerName: "Workload",
    width: 130,
    sortable: false,
    renderCell: (p) => {
      const row = p.row;
      if (!row.rowEnriched || !row.summaryState) {
        return (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        );
      }
      return (
        <Chip
          size="small"
          label={row.summaryState}
          color={namespaceRowSummaryStateColor(row.summaryState)}
          variant="outlined"
        />
      );
    },
  },
  {
    field: "podCount",
    headerName: "Pods",
    width: 72,
    align: "right",
    headerAlign: "right",
    sortable: false,
    renderCell: (p) => (
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {dashNum(p.row, "podCount")}
      </Typography>
    ),
  },
  {
    field: "deploymentCount",
    headerName: "Deploy",
    width: 72,
    align: "right",
    headerAlign: "right",
    sortable: false,
    renderCell: (p) => (
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {dashNum(p.row, "deploymentCount")}
      </Typography>
    ),
  },
  {
    field: "problematicCount",
    headerName: "Problems",
    width: 88,
    align: "right",
    headerAlign: "right",
    sortable: false,
    renderCell: (p) => {
      const row = p.row;
      const s = dashNum(row, "problematicCount");
      const n = row.problematicCount ?? 0;
      return (
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: "tabular-nums", color: row.rowEnriched && n > 0 ? "error.main" : "text.primary" }}
        >
          {s}
        </Typography>
      );
    },
  },
  {
    field: "podsWithRestarts",
    headerName: "Restarts",
    width: 110,
    sortable: false,
    renderCell: (p) => {
      const row = p.row;
      if (!row.rowEnriched) {
        return (
          <Typography variant="body2" color="text.secondary">
            —
          </Typography>
        );
      }
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {row.podsWithRestarts ?? 0}
          </Typography>
          {row.restartHotspot && <Chip size="small" label="Δ" color="warning" title="Elevated pod restarts (≥5)" />}
        </Box>
      );
    },
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 100,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function NamespacesTable({
  token,
  onNavigate,
}: {
  token: string;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const [rowProjection, setRowProjection] = useState<ApiNamespacesListResponse["rowProjection"] | null>(null);

  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiNamespacesListResponse>("/api/namespaces", token);
    setRowProjection(res.rowProjection ?? null);
    const items = res.items || [];
    return {
      rows: items.map((n) => ({ ...n, id: n.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback((row: Row, q: string) => {
    const lc = q.toLowerCase();
    const enriched = Boolean(row.rowEnriched);
    return (
      row.name.toLowerCase().includes(lc) ||
      (row.phase || "").toLowerCase().includes(lc) ||
      (row.summaryState || "").toLowerCase().includes(lc) ||
      (enriched && String(row.podCount ?? "").includes(lc)) ||
      (enriched && String(row.deploymentCount ?? "").includes(lc)) ||
      (enriched && String(row.problematicCount ?? "").includes(lc))
    );
  }, []);

  const title = useMemo(() => <span>{resourceLabel}</span>, []);

  const dataplaneMetaPrefix = useMemo(
    () =>
      rowProjection && rowProjection.totalRows > 0 ? (
        <Typography variant="caption" color="text.secondary" display="block">
          Row metrics: {rowProjection.enrichedRows}/{rowProjection.totalRows} namespaces (cap {rowProjection.cap})
          {rowProjection.note ? ` — ${rowProjection.note}` : ""}
        </Typography>
      ) : null,
    [rowProjection],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={title}
      dataplaneMetaPrefix={dataplaneMetaPrefix}
      columns={columns}
      fetchRows={fetchRows}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name, phase, workload state, counts)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.namespaces}
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <NamespaceDrawer
          open={open}
          onClose={onClose}
          token={token}
          namespaceName={selectedId}
          onNavigate={onNavigate}
        />
      )}
    />
  );
}
