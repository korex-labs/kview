import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Typography,
} from "@mui/material";
import type {
  ApiDashboardClusterResponse,
  DashboardSignalFilter,
  DashboardSignalItem,
  DashboardSignalsPanel as DashboardSignalsPanelData,
} from "../../../types/api";
import SignalHintIcons from "../../shared/SignalHintIcons";
import InfoHint from "../../shared/InfoHint";
import ScopedCountChip, { activeChipSx } from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import {
  signalCalculatedText,
  signalFirstSeenText,
  signalLastSeenText,
  signalSeverityColor,
} from "../../shared/signalFormat";
import type { InspectTarget } from "./dashboardTypes";
import type { SxProps, Theme } from "@mui/material/styles";

type DerivedData = NonNullable<NonNullable<ApiDashboardClusterResponse["item"]>["derived"]>;

type DerivedSignalRow = {
  key: string;
  type: "nodes" | "helm";
  kindLabel: string;
  primary: string;
  secondary: string;
  metric: string;
  signals: number;
  severity: string;
  target: InspectTarget;
};

// ---- pure helpers --------------------------------------------------------

function severityColor(severity: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
}

function signalLocation(f: DashboardSignalItem): string {
  if (f.scopeLocation) return `${f.scope || "scope"}: ${f.scopeLocation}`;
  if (f.namespace) return `namespace: ${f.namespace}`;
  if (f.scope) return f.scope;
  return "-";
}

function signalResourceName(f: DashboardSignalItem): string {
  return f.resourceName || f.name || f.namespace || f.kind;
}

function signalSortDirection(sort: string, descValue: string, ascValue: string): "asc" | "desc" | undefined {
  if (sort === descValue) return "desc";
  if (sort === ascValue) return "asc";
  return undefined;
}

function signalSortNext(sort: string, descValue: string, ascValue: string): string {
  if (sort === descValue) return ascValue;
  return descValue;
}

export function inspectTargetFromSignal(f: DashboardSignalItem): InspectTarget | null {
  const namespace = f.namespace || "";
  const name = f.name || (f.kind === "Namespace" ? namespace : "");
  if (!namespace || !name) return null;
  switch (f.kind) {
    case "Namespace":
    case "Pod":
    case "Job":
    case "CronJob":
    case "HorizontalPodAutoscaler":
    case "ConfigMap":
    case "Secret":
    case "ServiceAccount":
    case "PersistentVolumeClaim":
    case "HelmRelease":
    case "Service":
    case "Ingress":
    case "Role":
    case "RoleBinding":
      return { kind: f.kind, namespace, name };
    case "ResourceQuota":
      return { kind: "Namespace", namespace, name: namespace };
    default:
      return null;
  }
}

function signalFilterLabel(filter: string): string {
  switch (filter) {
    case "top": return "Top priority";
    case "high": return "High severity";
    case "medium": return "Medium severity";
    case "low": return "Low severity";
    case "Namespace": return "Empty namespaces";
    case "HelmRelease": return "Stuck Helm releases";
    case "Job": return "Jobs";
    case "CronJob": return "CronJobs";
    case "HorizontalPodAutoscaler": return "HPA";
    case "ConfigMap": return "Empty ConfigMaps";
    case "Secret": return "Empty Secrets";
    case "PersistentVolumeClaim": return "PVCs";
    case "ServiceAccount": return "Potentially unused service accounts";
    case "Service": return "Service endpoints";
    case "Ingress": return "Ingress routing";
    case "Role": return "Roles";
    case "RoleBinding": return "RoleBindings";
    case "ResourceQuota": return "Quota pressure";
    case "Pod": return "Pod restarts";
    default: return filter;
  }
}

function signalFilterGroupLabel(category?: string): string {
  switch (category) {
    case "severity": return "By Severity";
    case "kind": return "By Kind";
    case "signal_type": return "By Signal Reason";
    case "namespace": return "Top 5 Namespaces With Problems";
    case "derived": return "Derived";
    case "priority": return "Priority";
    default: return "Other";
  }
}

function signalFilterGroupOrder(category?: string): number {
  switch (category) {
    case "priority": return 0;
    case "severity": return 1;
    case "kind": return 2;
    case "signal_type": return 3;
    case "namespace": return 4;
    case "derived": return 5;
    default: return 6;
  }
}

function groupedSignalFilters(
  filters: DashboardSignalFilter[],
): Array<{ category: string; label: string; filters: DashboardSignalFilter[] }> {
  const byCategory = new Map<string, DashboardSignalFilter[]>();
  for (const filter of filters) {
    const category = filter.category || "other";
    byCategory.set(category, [...(byCategory.get(category) || []), filter]);
  }
  return Array.from(byCategory.entries())
    .sort(([a], [b]) => signalFilterGroupOrder(a) - signalFilterGroupOrder(b))
    .map(([category, items]) => ({ category, label: signalFilterGroupLabel(category), filters: items }));
}

function signalFilterColor(filter: DashboardSignalFilter): "error" | "warning" | "info" | "default" {
  if (filter.count <= 0) return "default";
  if (filter.severity === "high") return "error";
  if (filter.severity === "medium") return "warning";
  if (filter.severity === "low") return "info";
  return "default";
}

function signalFilterSeverityRow(filter: DashboardSignalFilter): "high" | "medium" | "low" {
  if (filter.severity === "high") return "high";
  if (filter.severity === "medium") return "medium";
  return "low";
}

function signalFilterRows(filters: DashboardSignalFilter[]): DashboardSignalFilter[][] {
  const rows: Record<"high" | "medium" | "low", DashboardSignalFilter[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const filter of filters) {
    rows[signalFilterSeverityRow(filter)].push(filter);
  }
  return [rows.high, rows.medium, rows.low].filter((row) => row.length > 0);
}

function hideSignalFilterWhenZero(filter: DashboardSignalFilter): boolean {
  return filter.category === "signal_type" || filter.category === "kind" || filter.category === "namespace";
}

function fallbackSignalFilters(panel: DashboardSignalsPanelData | undefined, topCount: number): DashboardSignalFilter[] {
  return [
    { id: "top", label: "Top priority", count: topCount, category: "priority" },
    { id: "high", label: "High severity", count: panel?.high ?? 0, category: "severity", severity: "high" },
    { id: "medium", label: "Medium severity", count: panel?.medium ?? 0, category: "severity", severity: "medium" },
    { id: "low", label: "Low severity", count: panel?.low ?? 0, category: "severity", severity: "low" },
  ];
}

// ---- sub-components ------------------------------------------------------

const panelSx = {
  p: 2,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
};

const sectionSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "transparent",
};

const signalTableSx = {
  tableLayout: "fixed",
  "& .MuiTableCell-root": {
    py: 0.65,
    verticalAlign: "top",
  },
  "& .MuiTableHead-root .MuiTableCell-root": {
    color: "text.secondary",
    fontSize: 12,
    fontWeight: 700,
  },
};

const filterMeasureSx = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: 0,
  overflow: "hidden",
  visibility: "hidden",
  pointerEvents: "none",
  display: "flex",
  flexWrap: "nowrap",
  gap: 0.75,
};

const filterFlatRowsSx = {
  display: "flex",
  flexWrap: "nowrap",
  gap: 0.75,
  maxWidth: "100%",
  overflow: "hidden",
};

const filterSplitRowsSx = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 0.75,
};

const filterRowSx = {
  display: "flex",
  flexWrap: "wrap",
  gap: 0.75,
  maxWidth: "100%",
};

const filterChipSx = {
  flexShrink: 0,
  maxWidth: "none",
} satisfies SxProps<Theme>;

const statusCellSx = { pl: 0, width: 104 };
const kindCellSx = { width: 132 };
const resourceCellSx = { width: "24%" };
const detailCellSx = { width: "auto" };
const seenCellSx = { width: 116, whiteSpace: "nowrap" };
const lastSeenCellSx = { pr: 0, width: 116, whiteSpace: "nowrap" };

function derivedMatchesQuery(row: DerivedSignalRow, query: string): boolean {
  if (!query) return true;
  return (
    row.kindLabel.toLowerCase().includes(query) ||
    row.primary.toLowerCase().includes(query) ||
    row.secondary.toLowerCase().includes(query) ||
    row.metric.toLowerCase().includes(query) ||
    row.type.includes(query)
  );
}

function derivedFilterMatches(row: DerivedSignalRow, filter: string): boolean {
  switch (filter) {
    case "derived":
      return true;
    case "derived:nodes":
      return row.type === "nodes";
    case "derived:helm":
      return row.type === "helm";
    case "derived:signals":
      return row.signals > 0;
    default:
      return false;
  }
}

function FilterChip({
  filter,
  label,
  count,
  color = "default",
  hideWhenZero = false,
  selected,
  onSelect,
}: {
  filter: string;
  label?: string;
  count: number;
  color?: "error" | "warning" | "info" | "default";
  hideWhenZero?: boolean;
  selected: boolean;
  onSelect: (filter: string) => void;
}) {
  if (hideWhenZero && count <= 0 && !selected) return null;
  const sx = selected ? { ...filterChipSx, ...activeChipSx(color) } : filterChipSx;
  return (
    <ScopedCountChip
      size="small"
      color={color}
      variant={selected ? "filled" : "outlined"}
      label={label || signalFilterLabel(filter)}
      count={count}
      onClick={() => onSelect(filter)}
      sx={sx}
    />
  );
}

function SignalFilterGroup({
  category,
  label,
  filters,
  selectedFilter,
  onSelect,
}: {
  category: string;
  label: string;
  filters: DashboardSignalFilter[];
  selectedFilter: string;
  onSelect: (filter: string) => void;
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [splitBySeverity, setSplitBySeverity] = useState(false);

  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;

    const updateSplit = () => {
      setSplitBySeverity(node.scrollWidth > node.clientWidth + 1);
    };

    updateSplit();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSplit);
      return () => window.removeEventListener("resize", updateSplit);
    }

    const resizeObserver = new ResizeObserver(updateSplit);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [filters, selectedFilter]);

  const renderFilter = (filter: DashboardSignalFilter) => (
    <FilterChip
      key={filter.id}
      filter={filter.id}
      label={filter.label}
      count={filter.count}
      color={signalFilterColor(filter)}
      hideWhenZero={hideSignalFilterWhenZero(filter)}
      selected={selectedFilter === filter.id}
      onSelect={onSelect}
    />
  );

  return (
    <Box sx={{ position: "relative" }}>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Box ref={measureRef} aria-hidden="true" sx={filterMeasureSx}>
        {filters.map(renderFilter)}
      </Box>
      {splitBySeverity ? (
        <Box sx={filterSplitRowsSx}>
          {signalFilterRows(filters).map((row) => (
            <Box key={`${category}-${signalFilterSeverityRow(row[0])}`} sx={filterRowSx}>
              {row.map(renderFilter)}
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={filterFlatRowsSx}>
          {filters.map(renderFilter)}
        </Box>
      )}
    </Box>
  );
}

// ---- exported component --------------------------------------------------

type Props = {
  signalPanel: DashboardSignalsPanelData | undefined;
  signalFilter: string;
  onSignalFilterChange: (filter: string) => void;
  signalsQuery: string;
  onSignalsQueryChange: (q: string) => void;
  signalsSort: string;
  onSignalsSortChange: (sort: string) => void;
  signalsPage: number;
  onSignalsPageChange: (page: number) => void;
  signalsRowsPerPage: number;
  onSignalsRowsPerPageChange: (n: number) => void;
  restartElevatedThreshold?: number;
  onInspect: (target: InspectTarget) => void;
  derived?: DerivedData;
  loading?: boolean;
};

export default function DashboardSignalsPanel({
  signalPanel,
  signalFilter,
  onSignalFilterChange,
  signalsQuery,
  onSignalsQueryChange,
  signalsSort,
  onSignalsSortChange,
  signalsPage,
  onSignalsPageChange,
  signalsRowsPerPage,
  onSignalsRowsPerPageChange,
  onInspect,
  derived,
  loading = false,
}: Props) {
  const topSignals = signalPanel?.top || [];
  const visibleSignals = signalPanel?.items || [];
  const derivedRows = useMemo<DerivedSignalRow[]>(() => {
    if (!derived) return [];
    const nodeRows = (derived.nodes.nodes || []).map((node) => ({
      type: "nodes" as const,
      key: `node/${node.name}`,
      kindLabel: "Node",
      primary: node.name,
      secondary: `${node.namespaceCount} namespace${node.namespaceCount === 1 ? "" : "s"} · ${node.runningPods}/${node.pods} running`,
      metric: `${node.restartCount} restarts · ${node.elevatedRestartPods} elevated`,
      signals: node.problematicPods,
      severity: node.severity,
      target: { kind: "Node" as const, namespace: "", name: node.name },
    }));
    const chartRows = (derived.helmCharts.charts || []).map((chart) => {
      const versionLabel =
        chart.versions && chart.versions.length > 1
          ? `${chart.versions.length} versions`
          : chart.versions?.[0]?.chartVersion || "unknown version";
      return {
        type: "helm" as const,
        key: `helm/${chart.chartName}`,
        kindLabel: "Helm chart",
        primary: chart.chartName,
        secondary: `${versionLabel} · ${chart.namespaceCount} namespace${chart.namespaceCount === 1 ? "" : "s"}`,
        metric: `${chart.releases} release${chart.releases === 1 ? "" : "s"}`,
        signals: chart.needsAttention || 0,
        severity: chart.needsAttention ? "medium" : "low",
        target: {
          kind: "HelmChart" as const,
          namespace: "",
          name: chart.chartName,
          chart: {
            chartName: chart.chartName,
            chartVersion:
              chart.versions && chart.versions.length > 1
                ? "multiple"
                : chart.versions?.[0]?.chartVersion || "",
            appVersion:
              chart.versions && chart.versions.length > 1
                ? "multiple"
                : chart.versions?.[0]?.appVersion || "",
            releases: chart.releases,
            namespaces: chart.namespaces || [],
            statuses: chart.statuses,
            needsAttention: chart.needsAttention,
            versions: chart.versions,
            derived: true,
            derivedSource: derived.helmCharts.meta.source,
            derivedCoverage: derived.helmCharts.meta.coverage,
            derivedNote: derived.helmCharts.meta.note,
          },
        },
      };
    });
    return [...nodeRows, ...chartRows];
  }, [derived]);
  const derivedFilter = signalFilter.startsWith("derived");
  const visibleDerivedRows = useMemo(() => {
    if (!derivedFilter) return [];
    const q = signalsQuery.trim().toLowerCase();
    return derivedRows
      .filter((row) => derivedFilterMatches(row, signalFilter))
      .filter((row) => derivedMatchesQuery(row, q));
  }, [derivedFilter, derivedRows, signalFilter, signalsQuery]);
  const pagedDerivedRows = visibleDerivedRows.slice(
    signalsPage * signalsRowsPerPage,
    signalsPage * signalsRowsPerPage + signalsRowsPerPage,
  );
  const visibleSignalsTotal = derivedFilter ? visibleDerivedRows.length : signalPanel?.itemsTotal ?? visibleSignals.length;
  const derivedProblemRows = derivedRows.filter((row) => row.signals > 0).length;
  const quickFilters: DashboardSignalFilter[] = [
    ...(signalPanel?.filters && signalPanel.filters.length > 0
      ? signalPanel.filters
      : fallbackSignalFilters(signalPanel, topSignals.length)),
    ...(derivedRows.length > 0
      ? [
          { id: "derived", label: "All derived", count: derivedRows.length, category: "derived" },
          { id: "derived:nodes", label: "Nodes", count: derived?.nodes.total ?? 0, category: "derived" },
          { id: "derived:helm", label: "Helm charts", count: derived?.helmCharts.total ?? 0, category: "derived" },
          { id: "derived:signals", label: "With signals", count: derivedProblemRows, category: "derived", severity: derivedProblemRows > 0 ? "medium" : undefined },
        ]
      : []),
  ];
  const filterGroups = groupedSignalFilters(quickFilters);
  const selectedFilterLabel =
    quickFilters.find((f) => f.id === signalFilter)?.label || signalFilterLabel(signalFilter);

  return (
    <Paper variant="outlined" sx={panelSx}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2" color="primary">
          Signals
        </Typography>
        <InfoHint
          title={
            signalPanel?.note ||
            "Click a chip to filter the list. Top priority is capped; category chips show all matching cached-scope signals."
          }
        />
      </Box>

      <Box sx={sectionSx}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Filter direct and derived cached-scope signals by severity, kind, signal reason, namespace, or derived source.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {filterGroups.map((group) => (
            <SignalFilterGroup
              key={group.category}
              category={group.category}
              label={group.label}
              filters={group.filters}
              selectedFilter={signalFilter}
              onSelect={onSignalFilterChange}
            />
          ))}
        </Box>
      </Box>

      <Box sx={{ ...sectionSx, flex: 1 }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
          <TextField
            size="small"
            label="Search signals"
            value={signalsQuery}
            onChange={(e) => {
              onSignalsQueryChange(e.target.value);
              onSignalsPageChange(0);
            }}
            placeholder="name, kind, namespace..."
            sx={{ minWidth: { xs: "100%", sm: 280 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {loading
              ? "Loading matching signals..."
              : `Showing ${derivedFilter ? pagedDerivedRows.length : visibleSignals.length} of ${visibleSignalsTotal} ${selectedFilterLabel.toLowerCase()} ${derivedFilter ? "row" : "signal"}${visibleSignalsTotal === 1 ? "" : "s"}.`}
          </Typography>
        </Box>
        {loading ? <LinearProgress sx={{ mb: 1 }} /> : null}

        {derivedFilter ? (
          pagedDerivedRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No derived rows match this filter.
            </Typography>
          ) : (
            <Table size="small" sx={signalTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={statusCellSx}>Status</TableCell>
                  <TableCell sx={kindCellSx}>Kind</TableCell>
                  <TableCell sx={resourceCellSx}>Resource</TableCell>
                  <TableCell sx={detailCellSx}>Details</TableCell>
                  <TableCell sx={seenCellSx}>First seen</TableCell>
                  <TableCell sx={lastSeenCellSx}>Last verified</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedDerivedRows.map((row) => (
                  <TableRow key={row.key} hover onClick={() => onInspect(row.target)} sx={{ cursor: "pointer" }}>
                    <TableCell sx={statusCellSx}>
                      <StatusChip
                        size="small"
                        color={row.signals > 0 ? severityColor(row.severity) : "default"}
                        label={row.signals > 0 ? row.severity : "ok"}
                      />
                    </TableCell>
                    <TableCell sx={kindCellSx}>
                      <Chip size="small" variant="outlined" label={row.kindLabel} />
                    </TableCell>
                    <TableCell sx={resourceCellSx}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {row.primary}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.secondary}
                      </Typography>
                    </TableCell>
                    <TableCell sx={detailCellSx}>
                      {row.signals > 0 ? (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                          <ScopedCountChip
                            size="small"
                            color={severityColor(row.severity)}
                            label="Signals"
                            count={row.signals}
                          />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.metric}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          No signals
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.signals > 0 ? "" : `${row.metric} · `}
                        Derived from cached {row.type === "nodes" ? "node and pod" : "Helm release"} data
                      </Typography>
                    </TableCell>
                    <TableCell sx={seenCellSx}>
                      <Typography variant="caption" color="text.secondary">
                        -
                      </Typography>
                    </TableCell>
                    <TableCell sx={lastSeenCellSx}>
                      <Typography variant="caption" color="text.secondary">
                        -
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : visibleSignals.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No cached-scope signals for this filter.
          </Typography>
        ) : (
            <Table size="small" sx={signalTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={statusCellSx}>Status</TableCell>
                  <TableCell sx={kindCellSx}>Kind</TableCell>
                  <TableCell sx={resourceCellSx}>Resource</TableCell>
                  <TableCell sx={detailCellSx}>Details</TableCell>
                  <TableCell sx={seenCellSx} sortDirection={signalSortDirection(signalsSort, "discovered_desc", "discovered_asc")}>
                    <TableSortLabel
                      active={signalsSort === "discovered_desc" || signalsSort === "discovered_asc"}
                      direction={signalSortDirection(signalsSort, "discovered_desc", "discovered_asc") || "desc"}
                      onClick={() => {
                        onSignalsSortChange(signalSortNext(signalsSort, "discovered_desc", "discovered_asc"));
                        onSignalsPageChange(0);
                      }}
                    >
                      First seen
                    </TableSortLabel>
                  </TableCell>
                  <TableCell
                    sx={lastSeenCellSx}
                    sortDirection={signalSortDirection(signalsSort, "last_seen_desc", "last_seen_asc")}
                  >
                    <TableSortLabel
                      active={signalsSort === "last_seen_desc" || signalsSort === "last_seen_asc"}
                      direction={signalSortDirection(signalsSort, "last_seen_desc", "last_seen_asc") || "desc"}
                      onClick={() => {
                        onSignalsSortChange(signalSortNext(signalsSort, "last_seen_desc", "last_seen_asc"));
                        onSignalsPageChange(0);
                      }}
                    >
                      Last verified
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
              {visibleSignals.map((f) => {
                const target = inspectTargetFromSignal(f);
                return (
                  <TableRow
                    key={`${f.kind}/${f.namespace || ""}/${f.name || ""}/${f.reason}`}
                    hover={!!target}
                    onClick={() => {
                      if (target) onInspect(target);
                    }}
                    sx={target ? { cursor: "pointer" } : undefined}
                  >
                    <TableCell sx={statusCellSx}>
                      <StatusChip size="small" color={signalSeverityColor(f.severity)} label={f.severity} />
                    </TableCell>
                    <TableCell sx={kindCellSx}>
                      <Chip size="small" variant="outlined" label={f.resourceKind || f.kind} />
                    </TableCell>
                    <TableCell sx={resourceCellSx}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {signalResourceName(f)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {signalLocation(f)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={detailCellSx}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {f.reason}
                        <SignalHintIcons likelyCause={f.likelyCause} suggestedAction={f.suggestedAction} />
                      </Typography>
                      {signalCalculatedText(f) ? (
                        <Typography variant="caption" color="text.secondary">
                          {signalCalculatedText(f)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell sx={seenCellSx}>
                      <Typography variant="caption" color="text.secondary">
                        {signalFirstSeenText(f)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={lastSeenCellSx}>
                      <Typography variant="caption" color="text.secondary">
                        {signalLastSeenText(f)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {visibleSignalsTotal > 0 ? (
          <TablePagination
            component="div"
            count={visibleSignalsTotal}
            page={signalsPage}
            rowsPerPage={signalsRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_, page) => onSignalsPageChange(page)}
            onRowsPerPageChange={(e) => {
              onSignalsRowsPerPageChange(Number(e.target.value));
              onSignalsPageChange(0);
            }}
            sx={{ borderTop: "1px solid var(--panel-border)", mt: 1 }}
          />
        ) : null}
      </Box>
    </Paper>
  );
}
