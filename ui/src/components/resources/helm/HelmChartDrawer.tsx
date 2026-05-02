import React, { useMemo, useState } from "react";
import {
  Box,
  Chip,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { valueOrDash } from "../../../utils/format";
import KeyValueTable from "../../shared/KeyValueTable";
import Section from "../../shared/Section";
import AttentionSummary from "../../shared/AttentionSummary";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import EmptyState from "../../shared/EmptyState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import { drawerBodySx, drawerTabContentSx, panelBoxSx } from "../../../theme/sxTokens";
import type { DashboardSignalItem, HelmChart, HelmChartVersion } from "../../../types/api";

function chartSignalSummary(chart: HelmChart, versions: HelmChartVersion[]): DashboardSignalItem[] {
  const signalCount = Number(chart.needsAttention || 0);
  if (signalCount <= 0) return [];
  const statusText = (chart.statuses || []).join(", ") || "unknown";
  const versionParts = versions
    .filter((version) => Number(version.needsAttention || 0) > 0)
    .map((version) => `${valueOrDash(version.chartVersion)}: ${version.needsAttention}`);
  return [{
    kind: "HelmChart",
    name: chart.chartName,
    severity: "medium",
    score: 60,
    signalType: "helm_chart_release_attention",
    reason: `${signalCount} release${signalCount === 1 ? "" : "s"} for this chart need attention.`,
    actualData: versionParts.length ? `Affected versions: ${versionParts.join(", ")}` : `Statuses: ${statusText}`,
    calculatedData: `Statuses: ${statusText}`,
    likelyCause: "One or more Helm releases for this chart are not in a healthy deployed state.",
    suggestedAction: "Open the affected Helm release rows for the chart version and inspect release status, hooks, events, and managed resources.",
  }];
}

export default function HelmChartDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  chart: HelmChart | null;
}) {
  const chart = props.chart;
  const [tab, setTab] = useState(0);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const versions = useMemo<HelmChartVersion[]>(() => {
    if (!chart) return [];
    if (chart.versions?.length) return chart.versions;
    if (!chart.chartVersion && !chart.appVersion) return [];
    return [{
      chartVersion: chart.chartVersion,
      appVersion: chart.appVersion,
      releases: chart.releases,
      namespaces: chart.namespaces,
      statuses: chart.statuses,
      needsAttention: chart.needsAttention,
    }];
  }, [chart]);
  const namespaces = chart?.namespaces || [];
  const statuses = chart?.statuses || [];
  const chartSignals = useMemo<DashboardSignalItem[]>(
    () => (chart ? chartSignalSummary(chart, versions) : []),
    [chart, versions],
  );

  const summaryItems = useMemo(
    () =>
      chart
        ? [
            { label: "Chart", value: valueOrDash(chart.chartName), monospace: true },
            { label: "Versions", value: versions.length > 1 ? String(versions.length) : valueOrDash(chart.chartVersion) },
            { label: "App Version", value: versions.length > 1 ? "multiple" : valueOrDash(chart.appVersion) },
            { label: "Releases", value: String(chart.releases) },
            { label: "Namespaces", value: String(namespaces.length) },
            { label: "Source", value: chart.derived ? "Derived" : "Direct" },
            { label: "Signals", value: String(chart.needsAttention || 0) },
          ]
        : [],
    [chart, namespaces.length, versions.length],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="helmcharts" title={<>Helm Chart: {chart?.chartName || "-"}</>} onClose={props.onClose}>
        {!chart ? (
          <EmptyState message="No Helm chart selected." />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="Versions" />} iconPosition="start" label="Versions" />
              <Tab icon={<DetailTabIcon label="Namespaces" />} iconPosition="start" label="Namespaces" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <AttentionSummary signals={chartSignals} />

                  {chart.derived ? (
                    <Section title="Derived Projection">
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          <StatusChip size="small" color="warning" variant="outlined" label="Derived" />
                          {chart.derivedSource ? <ScopedCountChip size="small" variant="outlined" label="Source" count={chart.derivedSource} /> : null}
                          {chart.derivedCoverage ? <ScopedCountChip size="small" variant="outlined" label="Coverage" count={chart.derivedCoverage} /> : null}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {chart.derivedNote || "This chart row is inferred from cached Helm release snapshots."}
                        </Typography>
                      </Box>
                    </Section>
                  ) : null}

                  {statuses.length > 0 ? (
                    <Section title="Statuses">
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                        {statuses.map((status) => (
                          <StatusChip key={status} size="small" label={status} variant="outlined" />
                        ))}
                      </Box>
                    </Section>
                  ) : null}
                </Box>
              )}

              {tab === 1 && (
                <Box sx={{ height: "100%", overflow: "auto" }}>
                  {versions.length === 0 ? (
                    <EmptyState message="No chart versions found." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Version</TableCell>
                          <TableCell>App Version</TableCell>
                          <TableCell>Releases</TableCell>
                          <TableCell>Namespaces</TableCell>
                          <TableCell>Statuses</TableCell>
                          <TableCell>Signals</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {versions.map((version) => (
                          <TableRow key={version.chartVersion || "unknown"}>
                            <TableCell>{valueOrDash(version.chartVersion)}</TableCell>
                            <TableCell>{valueOrDash(version.appVersion)}</TableCell>
                            <TableCell>{version.releases}</TableCell>
                            <TableCell>{version.namespaces?.length || 0}</TableCell>
                            <TableCell>{(version.statuses || []).join(", ") || "-"}</TableCell>
                            <TableCell>
                              {version.needsAttention ? (
                                <ScopedCountChip size="small" color="warning" label="Releases" count={version.needsAttention} />
                              ) : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {tab === 2 && (
                <Box sx={drawerTabContentSx}>
                  <Section title="Namespaces">
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                      {namespaces.length > 0 ? (
                        namespaces.map((ns) => (
                          <ResourceLinkChip key={ns} label={ns} onClick={() => setDrawerNamespace(ns)} />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </Box>
                  </Section>
                </Box>
              )}
            </Box>
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={props.token}
              namespaceName={drawerNamespace}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
