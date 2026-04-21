import React from "react";
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type {
  DashboardSignalItem,
  NamespacePodHealth,
  NamespaceProblematicResource,
  NamespaceSummaryMeta,
  NamespaceWorkloadHealthRollup,
  WorkloadKindHealthRollup,
} from "../../../types/api";
import { dataplaneCoarseStateChipColor } from "../../../utils/k8sUi";
import AttentionSummary, {
  type AttentionHealth,
  type AttentionReason,
} from "../../shared/AttentionSummary";
import EmptyState from "../../shared/EmptyState";
import Section from "../../shared/Section";
import StackedMetricBar from "../../shared/StackedMetricBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import {
  GAUGE_COLOR_HEALTHY,
  GAUGE_COLOR_WARNING,
  GAUGE_COLOR_ERROR,
  GAUGE_COLOR_NEUTRAL,
  GAUGE_COLOR_UNKNOWN,
} from "../../../theme/sxTokens";
import NamespaceActions from "./NamespaceActions";

function signalSeverityColor(severity?: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
}

function signalTarget(signal: DashboardSignalItem): string {
  if (!signal.name) return signal.namespace || signal.kind;
  return signal.namespace ? `${signal.namespace}/${signal.name}` : signal.name;
}

function signalNote(signal: DashboardSignalItem): string {
  const actual = signal.actualData || signal.reason;
  const parts = [actual];
  if (signal.calculatedData && signal.calculatedData !== actual) parts.push(`Calculated: ${signal.calculatedData}`);
  if (signal.likelyCause) parts.push(`Likely cause: ${signal.likelyCause}`);
  if (signal.suggestedAction) parts.push(`Next step: ${signal.suggestedAction}`);
  return parts.join(" ");
}

function problematicSignalColor(reason: string): "warning" | "error" {
  const normalized = reason.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("deadline")) return "error";
  return "warning";
}

function podHealthSummary(podHealth?: NamespacePodHealth): string {
  if (!podHealth) return "-";
  const total = podHealth.running + podHealth.pending + podHealth.failed + podHealth.succeeded + podHealth.unknown;
  if (total === 0) return "-";
  return `${podHealth.running} run · ${podHealth.pending} pend · ${podHealth.failed} fail · ${podHealth.succeeded} done · ${podHealth.unknown} unk / ${total}`;
}

function workloadSignalSummary(rollup?: WorkloadKindHealthRollup): string {
  if (!rollup || rollup.total === 0) return "-";
  return `${rollup.healthy} ok · ${rollup.progressing} prog · ${rollup.degraded} deg / ${rollup.total}`;
}


type Props = {
  token: string;
  namespaceName: string;
  workloadByKind?: NamespaceWorkloadHealthRollup;
  podHealth?: NamespacePodHealth;
  signals: DashboardSignalItem[];
  problematic: NamespaceProblematicResource[];
  summaryMeta?: NamespaceSummaryMeta;
  quotaPressure: { critical: number; warning: number };
  onClose: () => void;
  onOpenPod: (name: string) => void;
  onOpenDeployment: (name: string) => void;
  onOpenJob: (name: string) => void;
  onOpenHelmRelease: (name: string | null) => void;
  onNavigate: (sectionKey: string) => void;
  onSelectCapacityTab: () => void;
  onJumpToEvents?: () => void;
  onJumpToConditions?: () => void;
};

/**
 * buildAttentionSummary derives the props for the shared AttentionSummary
 * block from backend-provided fields only:
 *   - health: the dataplane coarse state of the namespace (ok / degraded / …);
 *   - reasons: compact backend-sourced counts (problematic resources, quota
 *     pressure). These are counts of backend-provided rows, not UI-derived
 *     thresholds. See docs/UI_UX_GUIDE.md.
 */
function buildAttentionSummary(
  signals: DashboardSignalItem[],
  summaryMeta?: NamespaceSummaryMeta,
  problematicCount?: number,
  quotaPressure?: { critical: number; warning: number },
): { health?: AttentionHealth; reasons: AttentionReason[] } {
  const reasons: AttentionReason[] = [];
  if (problematicCount && problematicCount > 0) {
    reasons.push({
      label: `${problematicCount} problematic resource${problematicCount === 1 ? "" : "s"}`,
      severity: "warning",
      tooltip: "Resources flagged by the backend as unhealthy or stuck.",
    });
  }
  if (quotaPressure) {
    if (quotaPressure.critical > 0) {
      reasons.push({
        label: `${quotaPressure.critical} quota entr${quotaPressure.critical === 1 ? "y" : "ies"} critical`,
        severity: "error",
        tooltip: "ResourceQuota entries at or above 90% usage (backend ratio).",
      });
    }
    if (quotaPressure.warning > 0) {
      reasons.push({
        label: `${quotaPressure.warning} quota entr${quotaPressure.warning === 1 ? "y" : "ies"} warning`,
        severity: "warning",
        tooltip: "ResourceQuota entries at or above 80% usage (backend ratio).",
      });
    }
  }

  let health: AttentionHealth | undefined;
  if (summaryMeta?.state) {
    const tone = dataplaneCoarseStateChipColor(summaryMeta.state);
    health = {
      label: `state: ${summaryMeta.state}`,
      tone,
      tooltip: "Coarse namespace state reported by the dataplane.",
    };
  } else if (signals.length > 0) {
    health = { label: `${signals.length} attention signal${signals.length === 1 ? "" : "s"}`, tone: "warning" };
  }
  return { health, reasons };
}

export default function NamespaceSignalsTab({
  token,
  namespaceName,
  workloadByKind,
  podHealth,
  signals,
  problematic,
  summaryMeta,
  quotaPressure,
  onClose,
  onOpenPod,
  onOpenDeployment,
  onOpenJob,
  onOpenHelmRelease,
  onNavigate,
  onSelectCapacityTab,
  onJumpToEvents,
  onJumpToConditions,
}: Props) {
  const attention = buildAttentionSummary(signals, summaryMeta, problematic.length, quotaPressure);
  function handleProblematic(resource: NamespaceProblematicResource) {
    switch (resource.kind) {
      case "Pod": onOpenPod(resource.name); return;
      case "Deployment": onOpenDeployment(resource.name); return;
      case "Job": onOpenJob(resource.name); return;
      case "DaemonSet": onNavigate("daemonSets"); return;
      case "StatefulSet": onNavigate("statefulSets"); return;
      case "CronJob": onNavigate("cronJobs"); return;
      case "HorizontalPodAutoscaler": onNavigate("horizontalPodAutoscalers"); return;
      case "ReplicaSet": onNavigate("replicaSets"); return;
    }
  }

  function handleSignal(signal: DashboardSignalItem) {
    switch (signal.kind) {
      case "Namespace":
      case "ResourceQuota":
        onSelectCapacityTab();
        return;
      case "HelmRelease": onOpenHelmRelease(signal.name || null); return;
      case "Job": onOpenJob(signal.name || ""); return;
      case "Pod": onOpenPod(signal.name || ""); return;
      case "ConfigMap": onNavigate("configMaps"); return;
      case "Secret": onNavigate("secrets"); return;
      case "PersistentVolumeClaim": onNavigate("pvcs"); return;
      case "ServiceAccount": onNavigate("serviceAccounts"); return;
      case "CronJob": onNavigate("cronJobs"); return;
      case "HorizontalPodAutoscaler": onNavigate("horizontalPodAutoscalers"); return;
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
      <Section title="Actions" divider={false}>
        <NamespaceActions token={token} namespaceName={namespaceName} onDeleted={onClose} />
      </Section>

      <AttentionSummary
        health={attention.health}
        reasons={attention.reasons}
        signals={signals}
        onJumpToEvents={onJumpToEvents}
        onJumpToConditions={onJumpToConditions}
      />

      {(workloadByKind || podHealth) && (
        <Section title="Health overview">
          <Box sx={{ mt: 1 }}>
              {podHealth && podHealthSummary(podHealth) !== "-" && (
                <GaugeTableRow
                  label="Pods"
                  bar={<StackedMetricBar segments={[
                    { label: "Running", value: podHealth.running, color: GAUGE_COLOR_HEALTHY },
                    { label: "Pending", value: podHealth.pending, color: GAUGE_COLOR_WARNING },
                    { label: "Failed", value: podHealth.failed, color: GAUGE_COLOR_ERROR },
                    { label: "Succeeded", value: podHealth.succeeded, color: GAUGE_COLOR_NEUTRAL },
                    { label: "Unknown", value: podHealth.unknown, color: GAUGE_COLOR_UNKNOWN },
                  ]} />}
                  summary={podHealthSummary(podHealth)}
                />
              )}
              {workloadByKind?.deployments?.total ? (
                <GaugeTableRow
                  label="Deployments"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.deployments.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.deployments.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.deployments.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.deployments)}
                />
              ) : null}
              {workloadByKind?.daemonSets?.total ? (
                <GaugeTableRow
                  label="DaemonSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.daemonSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.daemonSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.daemonSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.daemonSets)}
                />
              ) : null}
              {workloadByKind?.statefulSets?.total ? (
                <GaugeTableRow
                  label="StatefulSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.statefulSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.statefulSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.statefulSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.statefulSets)}
                />
              ) : null}
              {workloadByKind?.jobs?.total ? (
                <GaugeTableRow
                  label="Jobs"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.jobs.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.jobs.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.jobs.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.jobs)}
                />
              ) : null}
              {workloadByKind?.cronJobs?.total ? (
                <GaugeTableRow
                  label="CronJobs"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.cronJobs.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.cronJobs.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.cronJobs.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.cronJobs)}
                />
              ) : null}
              {workloadByKind?.replicaSets?.total ? (
                <GaugeTableRow
                  label="ReplicaSets"
                  bar={<StackedMetricBar segments={[
                    { label: "Healthy", value: workloadByKind.replicaSets.healthy, color: GAUGE_COLOR_HEALTHY },
                    { label: "Progressing", value: workloadByKind.replicaSets.progressing, color: GAUGE_COLOR_WARNING },
                    { label: "Degraded", value: workloadByKind.replicaSets.degraded, color: GAUGE_COLOR_ERROR },
                  ]} />}
                  summary={workloadSignalSummary(workloadByKind.replicaSets)}
                />
              ) : null}
          </Box>
        </Section>
      )}

      {problematic.length > 0 && (
        <Section title="Problematic resources">
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Kind</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Signal</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problematic.map((resource, index) => (
                <TableRow
                  key={`${resource.kind}-${resource.name}-${index}`}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => handleProblematic(resource)}
                >
                  <TableCell>
                    <Chip size="small" label={resource.kind} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{resource.name}</TableCell>
                  <TableCell>
                    <Chip size="small" color={problematicSignalColor(resource.reason)} label="attention" />
                  </TableCell>
                  <TableCell>{resource.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title="Signals">
        {signals.length === 0 ? (
          <EmptyState message="No namespace signals from cached dataplane scope." />
        ) : (
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Kind</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Signal</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {signals.map((signal, index) => (
                <TableRow
                  key={`${signal.kind}-${signal.name || signal.namespace || index}`}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => handleSignal(signal)}
                  title={signalNote(signal)}
                >
                  <TableCell>
                    <Chip size="small" label={signal.kind} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{signalTarget(signal)}</TableCell>
                  <TableCell>
                    <Chip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity} />
                  </TableCell>
                  <TableCell>{signalNote(signal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {summaryMeta && (
        <Section title="Dataplane status">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            <Chip
              size="small"
              label={`state: ${summaryMeta.state || "unknown"}`}
              color={dataplaneCoarseStateChipColor(summaryMeta.state)}
            />
            <Chip size="small" variant="outlined" label={`freshness: ${summaryMeta.freshness || "?"}`} />
            <Chip size="small" variant="outlined" label={`coverage: ${summaryMeta.coverage || "?"}`} />
            <Chip size="small" variant="outlined" label={`degradation: ${summaryMeta.degradation || "?"}`} />
            <Chip size="small" variant="outlined" label={`completeness: ${summaryMeta.completeness || "?"}`} />
          </Box>
        </Section>
      )}
    </Box>
  );
}
