import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
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
import ListSignalChip from "../../shared/ListSignalChip";
import ScopedCountChip from "../../shared/ScopedCountChip";
import { namespaceSmartSortKey } from "../../../state";

type Namespace = NonNullable<ApiNamespacesListResponse["items"]>[number];
type NamespaceProjectionUpdate = ApiNamespacesEnrichmentPoll["updates"][number];

type Row = Namespace & { id: string; isFavourite: boolean; smartNamespaceSortKey: string };

const resourceLabel = getResourceLabel("namespaces");

function titleCase(value: string): string {
  if (!value) return "";
  return value[0].toUpperCase() + value.slice(1);
}

function workloadLabel(row: Row): string {
  if (!row.rowEnriched) return "—";
  const pods = row.podCount ?? 0;
  const deployments = row.deploymentCount ?? 0;
  if ((row.summaryState || "").toLowerCase() === "empty" || (pods === 0 && deployments === 0)) return "Empty";
  return titleCase(row.summaryState || "ok");
}

function workloadCount(row: Row): string {
  return `${row.podCount ?? 0} / ${row.deploymentCount ?? 0}`;
}

function workloadTooltip(row: Row): string {
  if (!row.rowEnriched) return "Workload counts are still loading for this namespace.";
  return `Workload state from cached pod and deployment lists. Counts are pods / deployments: ${row.podCount ?? 0} / ${row.deploymentCount ?? 0}.`;
}

function quotaLabel(row: Row): string {
  if (!row.rowEnriched) return "—";
  const quotas = row.resourceQuotaCount ?? 0;
  const limits = row.limitRangeCount ?? 0;
  if (!quotas && !limits) return "None";
  return row.quotaCritical ? "Critical" : row.quotaWarning ? "Warn" : "Ok";
}

function quotaCount(row: Row): string {
  const counts = `${row.resourceQuotaCount ?? 0} / ${row.limitRangeCount ?? 0}`;
  const ratio = row.quotaMaxRatio;
  if (ratio == null || ratio <= 0) return counts;
  return `${Math.round(ratio * 100)}% · ${counts}`;
}

function quotaTooltip(row: Row): string {
  if (!row.rowEnriched) return "Quota and limit counts are still loading for this namespace.";
  const quotas = row.resourceQuotaCount ?? 0;
  const limits = row.limitRangeCount ?? 0;
  const ratio = row.quotaMaxRatio != null && row.quotaMaxRatio > 0
    ? ` Highest quota usage is ${Math.round(row.quotaMaxRatio * 100)}% of hard limit.`
    : "";
  return `ResourceQuota / LimitRange objects: ${quotas} / ${limits}.${ratio}`;
}

function mergeNamespaceProjection<T extends NamespaceProjectionUpdate>(base: T | undefined, patch: T): T {
  if (!base || !base.rowEnriched) return patch;
  if (!patch.rowEnriched) return base;
  return { ...base, ...patch };
}

const baseColumns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 200 },
  {
    field: "listSignalSeverity",
    headerName: "Signals",
    width: 120,
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
      return <ListSignalChip severity={row.listSignalSeverity} count={row.listSignalCount} />;
    },
  },
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
    width: 156,
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
      const label = workloadLabel(row);
      if (label === "Empty") {
        return (
          <Tooltip title={workloadTooltip(row)}>
            <Box component="span">
              <StatusChip
                size="small"
                label={label}
                color={dataplaneCoarseStateChipColor(row.summaryState || "empty")}
              />
            </Box>
          </Tooltip>
        );
      }
      return (
        <ScopedCountChip
          size="small"
          label={label}
          count={workloadCount(row)}
          color={dataplaneCoarseStateChipColor(row.summaryState || "ok")}
          title={workloadTooltip(row)}
        />
      );
    },
  },
  {
    field: "resourceQuotaCount",
    headerName: "Quota",
    width: 156,
    sortable: false,
    renderCell: (p) => {
      const row = p.row;
      const label = quotaLabel(row);
      if (!row.rowEnriched || label === "None") {
        return (
          <Tooltip title={quotaTooltip(row)}>
            <Box component="span">
              <StatusChip
                size="small"
                label={label}
                color={row.quotaCritical ? "error" : row.quotaWarning ? "warning" : "success"}
              />
            </Box>
          </Tooltip>
        );
      }
      return (
        <ScopedCountChip
          size="small"
          label={label}
          count={quotaCount(row)}
          color={row.quotaCritical ? "error" : row.quotaWarning ? "warning" : "success"}
          title={quotaTooltip(row)}
        />
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
  favourites,
  recentNamespaces,
  smartNamespaceSorting,
  onToggleFavourite,
  onNavigate,
}: {
  token: string;
  /** GET path for the namespaces list (optional query hints for prioritized row details). */
  listApiPath: string;
  favourites: string[];
  recentNamespaces?: string[];
  smartNamespaceSorting?: boolean;
  onToggleFavourite: (namespace: string) => void;
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
  const namespaceRowDetailsPollMs = settings.dataplane.global.namespaceEnrichment.pollMs;
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  const recentNamespaceList = useMemo(() => recentNamespaces || [], [recentNamespaces]);
  const smartSortingEnabled = Boolean(smartNamespaceSorting);
  const rowSortKey = useCallback(
    (name: string) => smartSortingEnabled ? namespaceSmartSortKey(name, favouriteSet, recentNamespaceList) : name,
    [favouriteSet, recentNamespaceList, smartSortingEnabled],
  );

  const columns = useMemo<GridColDef<Row>[]>(
    () => [
      {
        field: "smartNamespaceSortKey",
        headerName: "Smart sort",
        sortable: true,
        valueGetter: (_value, row) => row.smartNamespaceSortKey,
      },
      {
        field: "isFavourite",
        headerName: "Favourite",
        width: 56,
        align: "center",
        headerAlign: "center",
        sortable: true,
        valueGetter: (_value, row) => row.isFavourite,
        sortComparator: (a, b) => Number(Boolean(a)) - Number(Boolean(b)),
        renderHeader: () => (
          <Tooltip title="Favourite">
            <StarIcon fontSize="small" sx={{ color: "text.secondary" }} />
          </Tooltip>
        ),
        renderCell: (p) => {
          const isFavourite = Boolean(p.row.isFavourite);
          const label = isFavourite ? `Remove ${p.row.name} from favourites` : `Add ${p.row.name} to favourites`;
          return (
            <Tooltip title={label}>
              <IconButton
                size="small"
                aria-label={label}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavourite(p.row.name);
                }}
                sx={{ color: isFavourite ? "warning.main" : "text.secondary" }}
              >
                {isFavourite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          );
        },
      },
      ...baseColumns,
    ],
    [onToggleFavourite],
  );

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
      rows: items.map((n) => ({
        ...n,
        id: n.name,
        isFavourite: favouriteSet.has(n.name),
        smartNamespaceSortKey: rowSortKey(n.name),
      })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, listApiPath, favouriteSet, rowSortKey]);

  const mapRows = useCallback(
    (rows: Row[]) => {
      const listRev = rowProjection?.revision ?? 0;
      if (enrichedRowsByName.size === 0 && !enrichRows?.length) {
        return rows.map((r) => ({
          ...r,
          isFavourite: favouriteSet.has(r.name),
          smartNamespaceSortKey: rowSortKey(r.name),
        }));
      }
      const currentRevisionRows =
        listRev && enrichPoll != null && enrichPoll.revision === listRev && enrichRows?.length
          ? new Map(enrichRows.map((n) => [n.name, n]))
          : null;
      return rows.map((r) => {
        const current = currentRevisionRows?.get(r.name);
        const ex = current?.rowEnriched ? current : enrichedRowsByName.get(r.name);
        const isFavourite = favouriteSet.has(r.name);
        const smartNamespaceSortKey = rowSortKey(r.name);
        return ex
          ? ({ ...r, ...ex, id: r.name, isFavourite, smartNamespaceSortKey } as Row)
          : { ...r, isFavourite, smartNamespaceSortKey };
      });
    },
    [enrichRows, enrichPoll, enrichedRowsByName, favouriteSet, rowProjection?.revision, rowSortKey],
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
      (row.listSignalSeverity || "").toLowerCase().includes(lc) ||
      (enriched && String(row.podCount ?? "").includes(lc)) ||
      (enriched && String(row.deploymentCount ?? "").includes(lc)) ||
      (enriched && String(row.resourceQuotaCount ?? "").includes(lc)) ||
      (enriched && String(row.limitRangeCount ?? "").includes(lc))
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
      mapRowsDeps={[
        enrichRows,
        enrichPoll,
        enrichedRowsByName,
        favouriteSet,
        rowProjection?.revision,
        rowSortKey,
      ]}
      columns={columns}
      defaultSortField={smartSortingEnabled ? "smartNamespaceSortKey" : "name"}
      initialColumnVisibilityModel={{ smartNamespaceSortKey: false }}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "namespaces"),
        pollSec: defaultRevisionPollSec,
      }}
      dataplaneRefreshSec={0}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name, status, signals, workload, quota)"
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
