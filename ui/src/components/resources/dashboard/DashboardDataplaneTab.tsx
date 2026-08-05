import React from "react";
import { Box, Chip, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import type { ApiDashboardDataplaneResponse } from "../../../types/api";
import { dataplaneCoarseStateChipColor } from "../../../utils/k8sUi";
import { fmtAgeShort, fmtBytes, fmtByteRate, fmtPercent, fmtRate } from "../../../utils/format";
import {
  STAT_CELL_LABEL_WIDTH,
  GAUGE_COLOR_HEALTHY,
  GAUGE_COLOR_WARNING,
  GAUGE_COLOR_ERROR,
} from "../../../theme/sxTokens";
import InfoHint from "../../shared/InfoHint";
import MetricCard from "../../shared/MetricCard";
import StackedMetricBar from "../../shared/StackedMetricBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import ScopedCountChip from "../../shared/ScopedCountChip";
import { formatCPUMilli, formatMemoryBytes } from "../../metrics/format";

type Props = {
  item: NonNullable<ApiDashboardDataplaneResponse["item"]>;
  metricsUsable: boolean;
  refreshSec: number;
};

function stateChipColor(state: string): "success" | "warning" | "error" | "default" {
  return dataplaneCoarseStateChipColor(state) as "success" | "warning" | "error" | "default";
}

function PanelTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
      <Typography variant="subtitle2" color="primary">
        {title}
      </Typography>
      <InfoHint title={hint} />
    </Box>
  );
}

const dashboardPanelSectionSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "transparent",
};

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, py: 0.5, pl: 0, color: "text.secondary", width: STAT_CELL_LABEL_WIDTH }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 0.5, fontWeight: 600 }}>{value}</TableCell>
    </TableRow>
  );
}

export default function DashboardDataplaneTab({ item, metricsUsable, refreshSec }: Props) {
  const { plane, visibility, coverage: cov, resources, dataplane, usage } = item;
  const ns = visibility.namespaces;
  const nodes = visibility.nodes;
  const knownScope = `${cov.namespacesInResourceTotals} / ${cov.visibleNamespaces}`;

  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <MetricCard
          label="Known namespace scope"
          value={knownScope}
          color={cov.resourceTotalsCompleteness === "complete" ? "success" : "warning"}
          hint="Namespaces included in resource totals and signals."
        />
        <MetricCard
          label="Nodes"
          value={nodes.total}
          color={stateChipColor(nodes.state) === "default" ? "default" : stateChipColor(nodes.state)}
          hint={`State ${nodes.state}, freshness ${nodes.freshness}, observer ${nodes.observerState || "unknown"}.`}
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <PanelTitle
          title="Known Resources"
          hint="Resource counts are not inferred cluster totals; they are summed from cached namespace list snapshots."
        />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          {resources.aggregateFreshness ? <ScopedCountChip size="small" variant="outlined" label="Freshness" count={resources.aggregateFreshness} /> : null}
          {resources.aggregateDegradation && resources.aggregateDegradation !== "none" ? (
            <ScopedCountChip size="small" color="warning" label="Degradation" count={resources.aggregateDegradation} />
          ) : null}
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 1 }}>
          {[
            ["Pods", resources.pods],
            ["Deployments", resources.deployments],
            ["DaemonSets", resources.daemonSets],
            ["StatefulSets", resources.statefulSets],
            ["ReplicaSets", resources.replicaSets],
            ["Jobs", resources.jobs],
            ["CronJobs", resources.cronJobs],
            ["HPAs", resources.horizontalPodAutoscalers],
            ["Services", resources.services],
            ["Ingresses", resources.ingresses],
            ["PVCs", resources.persistentVolumeClaims],
            ["ConfigMaps", resources.configMaps],
            ["Secrets", resources.secrets],
            ["ServiceAccounts", resources.serviceAccounts],
            ["Roles", resources.roles],
            ["RoleBindings", resources.roleBindings],
            ["HelmReleases", resources.helmReleases],
            ["CustomResources", resources.customResources],
            ["ResourceQuotas", resources.resourceQuotas],
            ["LimitRanges", resources.limitRanges],
          ].map(([label, value]) => (
            <Box key={label} sx={{ border: "1px solid var(--panel-border)", borderRadius: 1, p: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="h6">{value}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {metricsUsable && usage ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <PanelTitle
            title="Cluster usage"
            hint="Cluster-wide CPU and memory rolled up from cached metrics.k8s.io snapshots. Pod totals sum across known namespaces; node totals sum across sampled nodes."
          />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {usage.freshness ? <ScopedCountChip size="small" variant="outlined" label="Freshness" count={usage.freshness} /> : null}
            <ScopedCountChip size="small" variant="outlined" label="Pods sampled" count={usage.podsWithMetrics} />
            <ScopedCountChip size="small" variant="outlined" label="Namespaces" count={usage.namespaces} />
            {usage.nodesSampled != null ? <ScopedCountChip size="small" variant="outlined" label="Nodes sampled" count={usage.nodesSampled} /> : null}
            {usage.note ? <Chip size="small" color="warning" variant="outlined" label={usage.note} /> : null}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
            <Box sx={dashboardPanelSectionSx}>
              <Typography variant="overline" color="text.secondary">Pods</Typography>
              <Table size="small">
                <TableBody>
                  <StatCell label="CPU" value={formatCPUMilli(usage.podCpuMilli) || "—"} />
                  <StatCell label="Memory" value={formatMemoryBytes(usage.podMemoryBytes) || "—"} />
                </TableBody>
              </Table>
            </Box>
            <Box sx={dashboardPanelSectionSx}>
              <Typography variant="overline" color="text.secondary">Nodes</Typography>
              <Table size="small">
                <TableBody>
                  <StatCell label="CPU" value={usage.nodeCpuMilli != null ? (formatCPUMilli(usage.nodeCpuMilli) || "—") : "—"} />
                  <StatCell label="Memory" value={usage.nodeMemoryBytes != null ? (formatMemoryBytes(usage.nodeMemoryBytes) || "—") : "—"} />
                </TableBody>
              </Table>
            </Box>
          </Box>
        </Paper>
      ) : null}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <PanelTitle title="Scope And Freshness" hint="Observation metadata moved here so the attention panel stays focused." />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            <ScopedCountChip size="small" variant="outlined" label="Profile" count={plane.profile} />
            <ScopedCountChip size="small" variant="outlined" label="Discovery" count={plane.discoveryMode} />
            <ScopedCountChip size="small" variant="outlined" label="Activation" count={plane.activationMode} />
            <ScopedCountChip size="small" variant="outlined" label="Refresh" count={refreshSec > 0 ? `${refreshSec}s` : "Manual"} />
            <ScopedCountChip size="small" variant="outlined" label="Totals" count={cov.resourceTotalsCompleteness} color={cov.resourceTotalsCompleteness === "unknown" ? "warning" : "default"} />
          </Box>
          <Table size="small">
            <TableBody>
              <StatCell label="Namespaces total / unhealthy" value={`${ns.total} / ${ns.unhealthy}`} />
              <StatCell label="Nodes total" value={nodes.total} />
              <StatCell label="Namespace snapshot" value={`${ns.state} / ${ns.freshness} / ${ns.completeness}`} />
              <StatCell label="Node list" value={`${nodes.state} / ${nodes.freshness} / ${nodes.completeness}`} />
              <StatCell label="Namespace observer" value={ns.observerState || "-"} />
              <StatCell label="Node observer" value={nodes.observerState || "-"} />
            </TableBody>
          </Table>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <PanelTitle title="Coverage" hint="Row projection coverage comes from cached pod/deployment snapshots and active enrichment sessions." />
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            <ScopedCountChip size="small" variant="outlined" label="Known lists" count={knownScope} />
            <ScopedCountChip size="small" variant="outlined" label="Row projections" count={cov.rowProjectionCachedNamespaces} />
            {cov.hasActiveEnrichmentSession ? <ScopedCountChip size="small" color="info" label="Enrichment" count="Active" /> : null}
          </Box>
          <Table size="small">
            <TableBody>
              <StatCell label="Visible namespaces" value={cov.visibleNamespaces} />
              <StatCell label="Without row projection" value={cov.listOnlyNamespaces} />
              <StatCell label="Detail fetches completed" value={cov.detailEnrichedNamespaces} />
              <StatCell label="Cached row projections" value={cov.relatedEnrichedNamespaces} />
              <StatCell label="Awaiting row projection" value={cov.awaitingRelatedRowProjection} />
              {cov.enrichmentTargets != null && cov.enrichmentTargets > 0 ? (
                <StatCell label="Enrichment targets" value={cov.enrichmentTargets} />
              ) : null}
            </TableBody>
          </Table>
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <PanelTitle
          title="Dataplane Stats"
          hint="Session-lifetime dataplane metrics since app startup. This tracks dataplane snapshot traffic and cache state only, not direct kube reads outside dataplane."
        />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
          <ScopedCountChip size="small" variant="outlined" label="Uptime" count={fmtAgeShort(dataplane.uptimeSec) || "0m"} />
          <ScopedCountChip size="small" variant="outlined" label="Requests" count={fmtRate(dataplane.traffic.requestsPerMin)} />
          <ScopedCountChip size="small" variant="outlined" label="Traffic" count={fmtByteRate(dataplane.traffic.liveBytesPerMin)} />
          <ScopedCountChip size="small" variant="outlined" label="Avg fetch" count={fmtBytes(dataplane.traffic.avgBytesPerFetch)} />
        </Box>
        <Box sx={dashboardPanelSectionSx}>
          <GaugeTableRow
            label="Requests"
            hint="All dataplane snapshot requests since app startup. Green is served from fresh cache; yellow needed a fetch."
            bar={<StackedMetricBar segments={[
              { label: "Fresh Hit", value: dataplane.requests.freshHits, color: GAUGE_COLOR_HEALTHY },
              { label: "Miss", value: dataplane.requests.misses, color: GAUGE_COLOR_WARNING },
            ]} />}
            summary={`${fmtPercent(dataplane.requests.hitRatio)} hit · ${dataplane.requests.freshHits}/${dataplane.requests.total} req`}
          />
          <GaugeTableRow
            label="Traffic Mix"
            hint="Payload bytes handled by dataplane. Green is restored from hydrated cache; yellow is newly fetched live payload."
            bar={<StackedMetricBar segments={[
              { label: "Hydrated Bytes", value: dataplane.traffic.hydratedBytes, color: GAUGE_COLOR_HEALTHY },
              { label: "Live Bytes", value: dataplane.traffic.liveBytes, color: GAUGE_COLOR_WARNING },
            ]} />}
            summary={`${fmtBytes(dataplane.traffic.liveBytes)} live · ${fmtBytes(dataplane.traffic.hydratedBytes)} restored`}
          />
          <GaugeTableRow
            label="Cache Footprint"
            hint="Current cached snapshot bytes compared with session live payload volume. Green is retained cache bytes; yellow is live bytes fetched this session."
            bar={<StackedMetricBar segments={[
              { label: "Cache Bytes", value: dataplane.cache.currentBytes, color: GAUGE_COLOR_HEALTHY },
              { label: "Session Live Bytes", value: dataplane.traffic.liveBytes, color: GAUGE_COLOR_WARNING },
            ]} />}
            summary={`${dataplane.cache.snapshotsStored} snapshots · ${fmtBytes(dataplane.cache.avgBytesPerSnapshot)} avg`}
          />
          <GaugeTableRow
            label="Execution"
            hint="Scheduler run-time spread. Green is average run duration; yellow is the remaining distance up to the slowest observed run."
            bar={<StackedMetricBar segments={[
              { label: "Average Run", value: dataplane.execution.avgRunMs, color: GAUGE_COLOR_HEALTHY },
              { label: "Headroom To Max", value: Math.max(0, dataplane.execution.maxRunMs - dataplane.execution.avgRunMs), color: GAUGE_COLOR_WARNING },
            ]} />}
            summary={`${dataplane.execution.avgRunMs}ms avg · ${dataplane.execution.maxRunMs}ms max · ${dataplane.execution.preemptions} preempt`}
          />
          {dataplane.sources?.map((source) => (
            <GaugeTableRow
              key={source.source}
              label={`${source.source.charAt(0).toUpperCase()}${source.source.slice(1)} Hit/Miss`}
              hint={`Dataplane requests attributed to ${source.source}. Green is requests satisfied without a new fetch; yellow needed a fetch; red ended in error.`}
              bar={<StackedMetricBar segments={[
                { label: `${source.source} Hit`, value: Math.max(0, source.requests - source.fetches), color: GAUGE_COLOR_HEALTHY },
                { label: `${source.source} Fetch`, value: source.fetches, color: GAUGE_COLOR_WARNING },
                { label: `${source.source} Error`, value: source.errors, color: GAUGE_COLOR_ERROR },
              ]} />}
              summary={`${fmtPercent(source.requests > 0 ? ((source.requests - source.fetches) * 100) / source.requests : 0)} hit · ${Math.max(0, source.requests - source.fetches)}/${source.requests} req`}
            />
          ))}
        </Box>
      </Paper>
    </>
  );
}
