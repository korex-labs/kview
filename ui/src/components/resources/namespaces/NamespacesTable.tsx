import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet, apiGetWithContext } from "../../../api";
import {
  type ApiNamespacesEnrichmentPoll,
  type ApiNamespacesListResponse,
  dataplaneListMetaFromResponse,
} from "../../../types/api";
import NamespaceDrawer from "./NamespaceDrawer";
import { fmtAge } from "../../../utils/format";
import { dataplaneCoarseStateChipColor, namespacePhaseChipColor } from "../../../utils/k8sUi";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import { useUserSettings } from "../../../settingsContext";
import StatusChip from "../../shared/StatusChip";

type Namespace = NonNullable<ApiNamespacesListResponse["items"]>[number];
type NamespaceProjectionUpdate = ApiNamespacesEnrichmentPoll["updates"][number];

type Row = Namespace & { id: string };

const resourceLabel = getResourceLabel("namespaces");

function dashNum(row: Row, key: "podCount" | "deploymentCount" | "problematicCount" | "podsWithRestarts"): string {
  if (!row.rowEnriched) return "—";
  const v = row[key];
  if (v === undefined || v === null) return "—";
  return String(v);
}

function quotaLabel(row: Row): string {
  if (!row.rowEnriched) return "—";
  const count = row.resourceQuotaCount ?? 0;
  if (!count) return "none";
  const ratio = row.quotaMaxRatio;
  if (ratio == null || ratio <= 0) return "configured";
  return `${Math.round(ratio * 100)}%`;
}

function mergeNamespaceProjection<T extends NamespaceProjectionUpdate>(base: T | undefined, patch: T): T {
  if (!base || !base.rowEnriched) return patch;
  if (!patch.rowEnriched) return base;
  return { ...base, ...patch };
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 200 },
  {
    field: "phase",
    headerName: "Status",
    width: 170,
    renderCell: (p) => {
      const phase = String(p.value || "");
      const row = p.row;
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", minHeight: "100%" }}>
          <StatusChip size="small" label={phase || "-"} color={namespacePhaseChipColor(phase)} />
          {row.hasUnhealthyConditions && (
            <StatusChip size="small" color="error" label="Unhealthy" />
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
        <StatusChip size="small" label={row.summaryState} color={dataplaneCoarseStateChipColor(row.summaryState)} variant="outlined" />
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: "100%" }}>
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {row.podsWithRestarts ?? 0}
          </Typography>
          {row.restartSignal && <StatusChip size="small" label="Delta" color="warning" />}
        </Box>
      );
    },
  },
  {
    field: "resourceQuotaCount",
    headerName: "Quota",
    width: 112,
    sortable: false,
    renderCell: (p) => {
      const row = p.row;
      return (
        <StatusChip
          size="small"
          label={quotaLabel(row)}
          color={row.quotaCritical ? "error" : row.quotaWarning ? "warning" : "default"}
          variant={row.rowEnriched && (row.resourceQuotaCount ?? 0) > 0 ? "outlined" : "filled"}
        />
      );
    },
  },
  {
    field: "limitRangeCount",
    headerName: "Limits",
    width: 88,
    align: "right",
    headerAlign: "right",
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
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
          {row.limitRangeCount ?? 0}
        </Typography>
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
  listApiPath,
  onNavigate,
}: {
  token: string;
  /** GET path for the namespaces list (optional query hints for prioritized row details). */
  listApiPath: string;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const [rowProjection, setRowProjection] = useState<ApiNamespacesListResponse["rowProjection"] | null>(null);
  const [enrichRows, setEnrichRows] = useState<ApiNamespacesEnrichmentPoll["updates"] | null>(null);
  const [enrichPoll, setEnrichPoll] = useState<ApiNamespacesEnrichmentPoll | null>(null);
  const [enrichedRowsByName, setEnrichedRowsByName] = useState<Map<string, NamespaceProjectionUpdate>>(
    () => new Map(),
  );
  const activeContext = useActiveContext();
  const { health } = useConnectionState();
  const { settings } = useUserSettings();
  const namespaceRowDetailsPollMs = settings.dataplane.namespaceEnrichment.pollMs;

  useEffect(() => {
    setEnrichRows(null);
    setEnrichPoll(null);
    setEnrichedRowsByName(new Map());
  }, [activeContext]);

  const fetchRows = useCallback(async (contextName?: string) => {
    // Do not clear enrichRows/enrichPoll here: clearing before the request completes drops merged
    // cells during loading and on every auto-refresh. mapRows only applies poll data when its
    // revision matches rowProjection.revision (after this fetch returns).
    const res = contextName
      ? await apiGetWithContext<ApiNamespacesListResponse>(listApiPath, token, contextName)
      : await apiGet<ApiNamespacesListResponse>(listApiPath, token);
    setRowProjection(res.rowProjection ?? null);
    const items = res.items || [];
    return {
      rows: items.map((n) => ({ ...n, id: n.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, listApiPath]);

  const mapRows = useCallback(
    (rows: Row[]) => {
      const listRev = rowProjection?.revision ?? 0;
      if (enrichedRowsByName.size === 0 && !enrichRows?.length) return rows;
      const currentRevisionRows =
        listRev && enrichPoll != null && enrichPoll.revision === listRev && enrichRows?.length
          ? new Map(enrichRows.map((n) => [n.name, n]))
          : null;
      return rows.map((r) => {
        const current = currentRevisionRows?.get(r.name);
        const ex = current?.rowEnriched ? current : enrichedRowsByName.get(r.name);
        return ex ? ({ ...r, ...ex, id: r.name } as Row) : r;
      });
    },
    [enrichRows, enrichPoll, enrichedRowsByName, rowProjection?.revision],
  );

  const revision = rowProjection?.revision ?? 0;

  useEffect(() => {
    if (health === "unhealthy") return;
    if (!revision || !token) return;

    let cancelled = false;
    let id = 0;
    const tick = async () => {
      if (cancelled) return;
      try {
        const path = `/api/namespaces/enrichment?revision=${revision}`;
        const res = activeContext
          ? await apiGetWithContext<ApiNamespacesEnrichmentPoll>(path, token, activeContext)
          : await apiGet<ApiNamespacesEnrichmentPoll>(path, token);
        if (cancelled) return;
        if (res.stale) {
          if (res.latestRevision) {
            setRowProjection((prev) => prev ? { ...prev, revision: res.latestRevision } : prev);
          }
          return;
        }
        const updates = res.updates ?? [];
        setEnrichRows(updates);
        setEnrichPoll(res);
        setEnrichedRowsByName((prev) => {
          if (!updates.length) return prev;
          let changed = false;
          const next = new Map(prev);
          for (const update of updates) {
            if (!update.rowEnriched) continue;
            next.set(update.name, mergeNamespaceProjection(next.get(update.name), update));
            changed = true;
          }
          return changed ? next : prev;
        });
        if (res.complete && id) window.clearInterval(id);
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    id = window.setInterval(tick, namespaceRowDetailsPollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeContext, health, namespaceRowDetailsPollMs, revision, token]);

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

  const listStatusPrefix = useMemo(() => {
    const total = rowProjection?.totalRows ?? 0;
    if (total <= 0) return null;
    const p = enrichPoll;
    const rawStage = p?.stage ?? rowProjection?.stage ?? "list";
    const d = p?.detailRows ?? 0;
    const r = p?.relatedRows ?? 0;
    const done = p?.complete ?? false;
    const targets = p?.enrichTargets ?? rowProjection?.cap ?? 0;
    const progressTotal = targets > 0 ? targets : total;
    const stageHint =
      rawStage === "complete" || done
        ? "Up to date"
        : rawStage === "detail"
          ? "Fetching namespace details"
          : rawStage === "related"
            ? "Loading workload counts"
            : rawStage === "sweep_idle_wait"
              ? "Waiting to sweep idle namespaces"
              : rawStage === "sweep_enriching"
                ? "Sweeping idle namespaces"
                : rawStage === "focused_idle_wait"
                  ? "Waiting to enrich focused namespaces"
                  : rawStage === "focused_enriching"
                    ? "Enriching focused namespaces"
            : "Preparing";
    const priorityHint =
      targets != null && targets > 0 ? ` · ${targets} namespace${targets === 1 ? "" : "s"} prioritized` : "";
    return (
      <Typography variant="caption" color="text.secondary" display="block">
        {stageHint}
        {!done ? ` · Details ${d}/${progressTotal} · Counts ${r}/${progressTotal}` : ""}
        {priorityHint}
        {rowProjection?.note ? ` — ${rowProjection.note}` : ""}
      </Typography>
    );
  }, [rowProjection, enrichPoll]);

  return (
    <ResourceListPage<Row>
      token={token}
      title={title}
      dataplaneMetaPrefix={listStatusPrefix}
      mapRows={mapRows}
      mapRowsDeps={[enrichRows, enrichPoll, enrichedRowsByName, rowProjection?.revision]}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "namespaces"),
        pollSec: defaultRevisionPollSec,
      }}
      dataplaneRefreshSec={0}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name, status, workload state, counts)"
      resourceLabel={resourceLabel}
      resourceKey="namespaces"
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
