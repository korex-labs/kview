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
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import EmptyState from "../../shared/EmptyState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import { drawerBodySx, drawerTabContentSx, panelBoxSx } from "../../../theme/sxTokens";

type HelmChartVersion = {
  chartVersion?: string;
  appVersion?: string;
  releases: number;
  namespaces?: string[];
  statuses?: string[];
  needsAttention?: number;
};

type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces?: string[];
  statuses?: string[];
  needsAttention?: number;
  versions?: HelmChartVersion[];
  derived?: boolean;
  derivedSource?: string;
  derivedCoverage?: string;
  derivedNote?: string;
};

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
      <ResourceDrawerShell title={<>Helm Chart: {chart?.chartName || "-"}</>} onClose={props.onClose}>
        {!chart ? (
          <EmptyState message="No Helm chart selected." />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Versions" />
              <Tab label="Namespaces" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  {chart.derived ? (
                    <Section title="Derived Projection">
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          <Chip size="small" color="warning" variant="outlined" label="Derived" />
                          {chart.derivedSource ? <Chip size="small" variant="outlined" label={`Source ${chart.derivedSource}`} /> : null}
                          {chart.derivedCoverage ? <Chip size="small" variant="outlined" label={`Coverage ${chart.derivedCoverage}`} /> : null}
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
                          <Chip key={status} size="small" label={status} variant="outlined" />
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
                              {version.needsAttention ? <Chip size="small" color="warning" label={version.needsAttention} /> : "-"}
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
