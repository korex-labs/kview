import React from "react";
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
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
import EmptyState from "../../shared/EmptyState";
import Section from "../../shared/Section";
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

type HealthBarSegment = { label: string; count: number; color: string };

function stackedHealthBar(segments: HealthBarSegment[]) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        height: 20,
        overflow: "hidden",
        borderRadius: 1,
        backgroundColor: "rgba(0,0,0,0.08)",
        border: "1px solid var(--panel-border)",
      }}
    >
      {segments.map((segment, index) =>
        segment.count > 0 ? (
          <Tooltip key={`${segment.label}-${index}`} title={`${segment.label}: ${segment.count}`}>
            <Box
              sx={{
                width: `${(segment.count / total) * 100}%`,
                backgroundColor: segment.color,
                minWidth: segment.count > 0 ? 6 : 0,
              }}
            />
          </Tooltip>
        ) : null
      )}
    </Box>
  );
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
};

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
}: Props) {
  function handleProblematic(resource: NamespaceProblematicResource) {
    switch (resource.kind) {
      case "Pod": onOpenPod(resource.name); return;
      case "Deployment": onOpenDeployment(resource.name); return;
      case "Job": onOpenJob(resource.name); return;
      case "DaemonSet": onNavigate("daemonSets"); return;
      case "StatefulSet": onNavigate("statefulSets"); return;
      case "CronJob": onNavigate("cronJobs"); return;
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
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
      <Section title="Actions" divider={false}>
        <NamespaceActions token={token} namespaceName={namespaceName} onDeleted={onClose} />
      </Section>

      {(workloadByKind || podHealth) && (
        <Section title="Health overview">
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "24%", fontWeight: 600 }}>Scope</TableCell>
                <TableCell sx={{ width: "46%", fontWeight: 600 }}>Health mix</TableCell>
                <TableCell sx={{ width: "30%", fontWeight: 600, textAlign: "right" }}>Summary</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {podHealth && podHealthSummary(podHealth) !== "-" && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Pods</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Running", count: podHealth.running, color: "#2e7d32" },
                      { label: "Pending", count: podHealth.pending, color: "#ed6c02" },
                      { label: "Failed", count: podHealth.failed, color: "#d32f2f" },
                      { label: "Succeeded", count: podHealth.succeeded, color: "#607d8b" },
                      { label: "Unknown", count: podHealth.unknown, color: "#8e24aa" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {podHealthSummary(podHealth)}
                  </TableCell>
                </TableRow>
              )}
              {workloadByKind?.deployments?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Deployments</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.deployments.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.deployments.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.deployments.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.deployments)}
                  </TableCell>
                </TableRow>
              ) : null}
              {workloadByKind?.daemonSets?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>DaemonSets</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.daemonSets.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.daemonSets.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.daemonSets.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.daemonSets)}
                  </TableCell>
                </TableRow>
              ) : null}
              {workloadByKind?.statefulSets?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>StatefulSets</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.statefulSets.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.statefulSets.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.statefulSets.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.statefulSets)}
                  </TableCell>
                </TableRow>
              ) : null}
              {workloadByKind?.jobs?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Jobs</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.jobs.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.jobs.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.jobs.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.jobs)}
                  </TableCell>
                </TableRow>
              ) : null}
              {workloadByKind?.cronJobs?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>CronJobs</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.cronJobs.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.cronJobs.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.cronJobs.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.cronJobs)}
                  </TableCell>
                </TableRow>
              ) : null}
              {workloadByKind?.replicaSets?.total ? (
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>ReplicaSets</TableCell>
                  <TableCell>
                    {stackedHealthBar([
                      { label: "Healthy", count: workloadByKind.replicaSets.healthy, color: "#2e7d32" },
                      { label: "Progressing", count: workloadByKind.replicaSets.progressing, color: "#ed6c02" },
                      { label: "Degraded", count: workloadByKind.replicaSets.degraded, color: "#d32f2f" },
                    ])}
                  </TableCell>
                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                    {workloadSignalSummary(workloadByKind.replicaSets)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Section>
      )}

      <Section title="Attention summary">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
          <Chip
            size="small"
            color={signals.some((s) => s.severity === "high") ? "error" : signals.some((s) => s.severity === "medium") ? "warning" : "success"}
            label={`Signals: ${signals.length}`}
          />
          {problematic.length > 0 && <Chip size="small" color="warning" label={`Problematic resources: ${problematic.length}`} />}
          {(quotaPressure.critical > 0 || quotaPressure.warning > 0) && (
            <Chip
              size="small"
              color={quotaPressure.critical > 0 ? "error" : "warning"}
              label={`Quota pressure: ${quotaPressure.critical} critical · ${quotaPressure.warning} warning`}
            />
          )}
        </Box>
      </Section>

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
