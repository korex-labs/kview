import React, { useDeferredValue, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { ApiDashboardClusterResponse } from "../../../types/api";
import InfoHint from "../../shared/InfoHint";
import type { DerivedFilter, InspectTarget } from "./dashboardTypes";

type DerivedData = NonNullable<NonNullable<ApiDashboardClusterResponse["item"]>["derived"]>;

const sectionSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "var(--bg-secondary)",
};

function severityColor(severity: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
}

function derivedFilterLabel(filter: DerivedFilter): string {
  switch (filter) {
    case "all": return "All derived";
    case "nodes": return "Nodes";
    case "helm": return "Helm charts";
    case "signals": return "With signals";
    default: return filter;
  }
}

function DerivedFilterChip({
  filter,
  count,
  selected,
  onSelect,
}: {
  filter: DerivedFilter;
  count: number;
  selected: boolean;
  onSelect: (filter: DerivedFilter) => void;
}) {
  return (
    <Chip
      size="small"
      color={filter === "signals" && count > 0 ? "warning" : "default"}
      variant={selected ? "filled" : "outlined"}
      label={`${derivedFilterLabel(filter)} ${count}`}
      onClick={() => onSelect(filter)}
    />
  );
}

type Props = {
  derived: DerivedData;
  onInspect: (target: InspectTarget) => void;
};

export default function DashboardDerivedPanel({ derived, onInspect }: Props) {
  const [derivedFilter, setDerivedFilter] = useState<DerivedFilter>("all");
  const [derivedQuery, setDerivedQuery] = useState("");
  const [derivedPage, setDerivedPage] = useState(0);
  const [derivedRowsPerPage, setDerivedRowsPerPage] = useState(10);
  const deferredQuery = useDeferredValue(derivedQuery);

  const derivedRows = useMemo(() => {
    const nodeRows = (derived.nodes.nodes || []).map((node) => ({
      type: "nodes" as const,
      key: `node/${node.name}`,
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

  const filteredRows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return derivedRows.filter((row) => {
      if (derivedFilter === "nodes" && row.type !== "nodes") return false;
      if (derivedFilter === "helm" && row.type !== "helm") return false;
      if (derivedFilter === "signals" && row.signals <= 0) return false;
      if (!q) return true;
      return (
        row.primary.toLowerCase().includes(q) ||
        row.secondary.toLowerCase().includes(q) ||
        row.metric.toLowerCase().includes(q) ||
        row.type.includes(q)
      );
    });
  }, [deferredQuery, derivedFilter, derivedRows]);

  const visibleRows = useMemo(
    () => filteredRows.slice(derivedPage * derivedRowsPerPage, derivedPage * derivedRowsPerPage + derivedRowsPerPage),
    [derivedPage, derivedRowsPerPage, filteredRows],
  );

  const selectFilter = (filter: DerivedFilter) => {
    setDerivedFilter(filter);
    setDerivedPage(0);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2" color="primary">
          Derived Signals
        </Typography>
        <InfoHint title="Explicitly derived projections from cached dataplane snapshots. These do not perform hidden live Kubernetes reads and may be sparse." />
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
        <Chip size="small" variant="outlined" label={`Node source ${derived.nodes.meta.source}`} />
        <Chip size="small" variant="outlined" label={`Helm source ${derived.helmCharts.meta.source}`} />
        <Chip size="small" color="warning" variant="outlined" label="Sparse / inexact" />
      </Box>
      <Box sx={sectionSx}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Filter sparse derived node and Helm chart rows. These rows preserve the normal Nodes and Helm Charts inspect targets.
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          <DerivedFilterChip filter="all" count={derivedRows.length} selected={derivedFilter === "all"} onSelect={selectFilter} />
          <DerivedFilterChip filter="nodes" count={derived.nodes.total} selected={derivedFilter === "nodes"} onSelect={selectFilter} />
          <DerivedFilterChip filter="helm" count={derived.helmCharts.total} selected={derivedFilter === "helm"} onSelect={selectFilter} />
          <DerivedFilterChip
            filter="signals"
            count={derivedRows.filter((row) => row.signals > 0).length}
            selected={derivedFilter === "signals"}
            onSelect={selectFilter}
          />
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1 }}>
          <TextField
            size="small"
            label="Search derived signals"
            value={derivedQuery}
            onChange={(e) => {
              setDerivedQuery(e.target.value);
              setDerivedPage(0);
            }}
            placeholder="node, chart, version..."
            sx={{ minWidth: { xs: "100%", sm: 280 } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            Showing {visibleRows.length} of {filteredRows.length} derived row{filteredRows.length === 1 ? "" : "s"}.
          </Typography>
        </Box>
        {visibleRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No derived rows match this filter.
          </Typography>
        ) : (
          <Table size="small">
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.key} hover onClick={() => onInspect(row.target)} sx={{ cursor: "pointer" }}>
                  <TableCell sx={{ border: 0, py: 0.6, pl: 0, width: 120, verticalAlign: "top" }}>
                    <Chip size="small" label={row.type === "nodes" ? "Node" : "Helm chart"} variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {row.primary}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.secondary}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top" }}>
                    {row.metric}
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.6, verticalAlign: "top", width: 120 }}>
                    {row.signals > 0 ? (
                      <Chip
                        size="small"
                        color={severityColor(row.severity)}
                        label={`${row.signals} signal${row.signals === 1 ? "" : "s"}`}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        -
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.6, pr: 0, textAlign: "right", verticalAlign: "top", width: 100 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspect(row.target);
                      }}
                    >
                      Inspect
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {filteredRows.length > 0 ? (
          <TablePagination
            component="div"
            count={filteredRows.length}
            page={derivedPage}
            rowsPerPage={derivedRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_, page) => setDerivedPage(page)}
            onRowsPerPageChange={(e) => {
              setDerivedRowsPerPage(Number(e.target.value));
              setDerivedPage(0);
            }}
            sx={{ borderTop: "1px solid var(--panel-border)", mt: 1 }}
          />
        ) : null}
      </Box>
    </Paper>
  );
}
