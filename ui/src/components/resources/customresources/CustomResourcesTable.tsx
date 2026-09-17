import React, { useCallback, useMemo, useState } from "react";
import { useActiveContext } from "../../../activeContext";
import CustomResourceKindTable, { type ExactKind } from "./CustomResourceKindTable";
import { Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import { fmtAge } from "../../../utils/format";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import CustomResourceDrawer, { type CRRef } from "./CustomResourceDrawer";
import CustomResourceStatusCell from "./CustomResourceStatusCell";
import CustomResourceAggregationMeta, { type AggregationMeta } from "./CustomResourceAggregationMeta";
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
  provenance?: "kubernetes" | "helmManifest";
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
    field: "provenance",
    headerName: "Source",
    width: 130,
    valueGetter: (_value, row) => row.provenance === "kubernetes" ? "Live API" : row.provenance === "helmManifest" ? "Helm manifest" : "Unknown source",
  },
  {
    field: "signalSeverity",
    headerName: "Status",
    width: 150,
    renderCell: (p) => <CustomResourceStatusCell severity={p.row.signalSeverity} summary={p.row.statusSummary} />,
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

export default function CustomResourcesTable(props: { token: string; namespace: string; filterIntent?: { value: string; nonce: number } | null; onFilterIntentApplied?: (nonce: number) => void }) {
  const context = useActiveContext();
  return <CustomResourcesContent key={JSON.stringify([context, props.token, props.namespace])} {...props} />;
}
function CustomResourcesContent({
  token,
  namespace,
  filterIntent,
  onFilterIntentApplied,
}: {
  token: string;
  namespace: string;
  filterIntent?: { value: string; nonce: number } | null;
  onFilterIntentApplied?: (nonce: number) => void;
}) {
  const [aggMeta, setAggMeta] = useState<AggregationMeta | null>(null);
  const [exactKind, setExactKind] = useState<ExactKind | null>(null);
  const kindColumns = useMemo<GridColDef<Row>[]>(() => columns.map((column) => column.field !== "kind" ? column : {
    ...column,
    renderCell: (p) => <Chip size="small" label={`${p.row.kind} · ${p.row.version}`} variant="outlined"
      title={`${p.row.group}/${p.row.version}/${p.row.resource} · Namespaced`}
      disabled={p.row.provenance !== "kubernetes" || !p.row.group || !p.row.version || !p.row.resource}
      onClick={(event) => { event.stopPropagation(); setExactKind({ group: p.row.group, version: p.row.version, resource: p.row.resource, scope: "Namespaced" }); }} />,
  }), []);

  const fetchRows = useCallback(async (contextName?: string, _reason?: unknown, signal?: AbortSignal): Promise<ResourceListFetchResult<Row>> => {
    const res = await apiGetWithContext<{ items?: CRInstanceItem[]; meta?: AggregationMeta }>(
      `/api/namespaces/${encodeURIComponent(namespace)}/customresources`,
      token,
      contextName || "",
      { signal },
    );
    const items = res.items || [];
    if (!signal?.aborted) setAggMeta(res.meta ?? null);
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
      (row.statusSummary || "").toLowerCase().includes(q) ||
      (row.provenance === "kubernetes" ? "live api" : row.provenance === "helmManifest" ? "helm manifest" : "unknown source").includes(q),
    [],
  );

  const metaPrefix = <CustomResourceAggregationMeta meta={aggMeta} />;

  if (exactKind) return <CustomResourceKindTable token={token} kind={exactKind} namespace={namespace} onBack={() => setExactKind(null)} />;
  return (
    <ResourceListPage<Row>
      token={token}
      title={`${resourceLabel} · ${namespace}`}
      columns={kindColumns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "customresources", namespace),
        pollSec: defaultRevisionPollSec,
      }}
      filterPredicate={filterPredicate}
      filterIntent={filterIntent}
      onFilterIntentApplied={onFilterIntentApplied}
      resourceKey="customresources"
      namespace={namespace}
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
              provenance: selectedRow.provenance,
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
