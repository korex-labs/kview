import React from "react";
import {
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { DashboardSignalFilter, DashboardSignalItem, DashboardSignalsPanel as DashboardSignalsPanelData } from "../../../types/api";
import SignalHintIcons from "../../shared/SignalHintIcons";
import InfoHint from "../../shared/InfoHint";
import type { InspectTarget } from "./dashboardTypes";

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

function signalCalculatedText(f: DashboardSignalItem): string {
  return f.calculatedData || f.reason;
}

function signalActualText(f: DashboardSignalItem): string {
  return f.actualData || f.reason;
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
    default: return 5;
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
  backgroundColor: "var(--bg-secondary)",
};

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
  return (
    <Chip
      size="small"
      color={color}
      variant={selected ? "filled" : "outlined"}
      label={`${label || signalFilterLabel(filter)} ${count}`}
      onClick={() => onSelect(filter)}
    />
  );
}

// ---- exported component --------------------------------------------------

type Props = {
  signalPanel: DashboardSignalsPanelData | undefined;
  signalFilter: string;
  onSignalFilterChange: (filter: string) => void;
  signalsQuery: string;
  onSignalsQueryChange: (q: string) => void;
  signalsPage: number;
  onSignalsPageChange: (page: number) => void;
  signalsRowsPerPage: number;
  onSignalsRowsPerPageChange: (n: number) => void;
  restartElevatedThreshold?: number;
  onInspect: (target: InspectTarget) => void;
};

export default function DashboardSignalsPanel({
  signalPanel,
  signalFilter,
  onSignalFilterChange,
  signalsQuery,
  onSignalsQueryChange,
  signalsPage,
  onSignalsPageChange,
  signalsRowsPerPage,
  onSignalsRowsPerPageChange,
  onInspect,
}: Props) {
  const topSignals = signalPanel?.top || [];
  const visibleSignals = signalPanel?.items || [];
  const visibleSignalsTotal = signalPanel?.itemsTotal ?? visibleSignals.length;
  const quickFilters =
    signalPanel?.filters && signalPanel.filters.length > 0
      ? signalPanel.filters
      : fallbackSignalFilters(signalPanel, topSignals.length);
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
          Filter cached-scope signals by severity, kind, signal reason, or namespace.
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {filterGroups.map((group) => (
            <Box key={group.category}>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                {group.label}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {group.filters.map((filter) => (
                  <FilterChip
                    key={filter.id}
                    filter={filter.id}
                    label={filter.label}
                    count={filter.count}
                    color={signalFilterColor(filter)}
                    hideWhenZero={
                      filter.category === "signal_type" ||
                      filter.category === "kind" ||
                      filter.category === "namespace"
                    }
                    selected={signalFilter === filter.id}
                    onSelect={onSignalFilterChange}
                  />
                ))}
              </Box>
            </Box>
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
            Showing {visibleSignals.length} of {visibleSignalsTotal}{" "}
            {selectedFilterLabel.toLowerCase()} signal{visibleSignalsTotal === 1 ? "" : "s"}.
          </Typography>
        </Box>

        {visibleSignals.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No cached-scope signals for this filter.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ pl: 0 }}>Severity</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Resource</TableCell>
                <TableCell>Signal</TableCell>
                <TableCell sx={{ pr: 0, textAlign: "right" }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleSignals.map((f) => {
                const target = inspectTargetFromSignal(f);
                return (
                  <TableRow key={`${f.kind}/${f.namespace || ""}/${f.name || ""}/${f.reason}`}>
                    <TableCell sx={{ py: 0.6, pl: 0, width: 104, verticalAlign: "top" }}>
                      <Chip size="small" color={severityColor(f.severity)} label={f.severity} />
                    </TableCell>
                    <TableCell sx={{ py: 0.6, width: 132, verticalAlign: "top" }}>
                      <Chip size="small" variant="outlined" label={f.resourceKind || f.kind} />
                    </TableCell>
                    <TableCell sx={{ py: 0.6, verticalAlign: "top" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {signalResourceName(f)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {signalLocation(f)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 0.6, verticalAlign: "top" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {signalCalculatedText(f)}
                        <SignalHintIcons likelyCause={f.likelyCause} suggestedAction={f.suggestedAction} />
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {signalActualText(f)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 0.6, pr: 0, textAlign: "right", width: 110, verticalAlign: "top" }}>
                      {target ? (
                        <Button size="small" variant="outlined" onClick={() => onInspect(target)}>
                          Inspect
                        </Button>
                      ) : null}
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
