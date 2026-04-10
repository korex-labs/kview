import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  LinearProgress,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import { apiGet } from "../../../api";
import type { ApiItemResponse } from "../../../types/api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, valueOrDash } from "../../../utils/format";
import {
  dataplaneCoarseStateChipColor,
  helmStatusChipColor,
  namespacePhaseChipColor,
} from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import ConditionsTable from "../../shared/ConditionsTable";
import CodeBlock from "../../shared/CodeBlock";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import MetadataSection from "../../shared/MetadataSection";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import RightDrawer from "../../layout/RightDrawer";
import Section from "../../shared/Section";
import NamespaceActions from "./NamespaceActions";
import PodDrawer from "../pods/PodDrawer";
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import JobDrawer from "../jobs/JobDrawer";
import HelmReleaseDrawer from "../helm/HelmReleaseDrawer";
import { drawerBodySx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";

type NamespaceDetails = {
  summary: NamespaceSummary;
  metadata: NamespaceMetadata;
  conditions: NamespaceCondition[];
  yaml: string;
};

type NamespaceSummary = {
  name: string;
  phase: string;
  createdAt: number;
  ageSec: number;
};

type NamespaceMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type NamespaceCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type NamespaceInsights = {
  summary: NamespaceSummaryResources;
  findings?: NamespaceFinding[];
  resourceQuotas?: ResourceQuota[];
  limitRanges?: LimitRange[];
};

type NamespaceFinding = {
  kind: string;
  namespace?: string;
  name?: string;
  severity: string;
  score: number;
  reason: string;
  likelyCause?: string;
  suggestedAction?: string;
  confidence?: string;
  section?: string;
};

type WorkloadKindHealthRollup = {
  total: number;
  healthy: number;
  progressing: number;
  degraded: number;
};

type NamespaceWorkloadHealthRollup = {
  deployments: WorkloadKindHealthRollup;
  daemonSets: WorkloadKindHealthRollup;
  statefulSets: WorkloadKindHealthRollup;
  jobs: WorkloadKindHealthRollup;
  cronJobs: WorkloadKindHealthRollup;
  replicaSets: WorkloadKindHealthRollup;
};

type PodRestartHotspot = {
  namespace: string;
  name: string;
  restarts: number;
  phase: string;
  node?: string;
  lastEventReason?: string;
  severity: string;
};

type NamespaceSummaryResources = {
  counts: ResourceCounts;
  podHealth: PodHealth;
  deploymentHealth: DeploymentHealth;
  problematic: ProblematicResource[];
  helmReleases?: NamespaceHelmRelease[];
  workloadByKind?: NamespaceWorkloadHealthRollup;
  restartHotspots?: PodRestartHotspot[];
  meta?: NamespaceSummaryMeta;
};

type ResourceCounts = {
  pods: number;
  deployments: number;
  statefulSets: number;
  daemonSets: number;
  jobs: number;
  cronJobs: number;
  services: number;
  ingresses: number;
  pvcs: number;
  configMaps: number;
  secrets: number;
  serviceAccounts: number;
  roles: number;
  roleBindings: number;
  helmReleases: number;
  resourceQuotas?: number;
  limitRanges?: number;
};

type PodHealth = {
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
};

type DeploymentHealth = {
  healthy: number;
  degraded: number;
  progressing: number;
};

type ProblematicResource = {
  kind: string;
  name: string;
  reason: string;
};

type NamespaceHelmRelease = {
  name: string;
  status: string;
  revision: number;
};

type NamespaceSummaryMeta = {
  freshness: string;
  coverage: string;
  degradation: string;
  completeness: string;
  state: string;
};

type ResourceQuotaEntry = {
  key: string;
  used: string;
  hard: string;
  ratio?: number;
};

type ResourceQuota = {
  name: string;
  namespace: string;
  ageSec: number;
  entries: ResourceQuotaEntry[];
};

type LimitRangeItem = {
  type: string;
  min?: Record<string, string>;
  max?: Record<string, string>;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
};

type LimitRange = {
  name: string;
  namespace: string;
  ageSec: number;
  items: LimitRangeItem[];
};

const tabs = ["Signals", "Inventory", "Capacity", "Metadata", "YAML"] as const;
const metadataTabIndex = tabs.indexOf("Metadata");
const yamlTabIndex = tabs.indexOf("YAML");

const sectionMap: Record<string, string> = {
  pods: "pods",
  deployments: "deployments",
  statefulSets: "statefulsets",
  daemonSets: "daemonsets",
  jobs: "jobs",
  cronJobs: "cronjobs",
  services: "services",
  ingresses: "ingresses",
  pvcs: "persistentvolumeclaims",
  configMaps: "configmaps",
  secrets: "secrets",
  helmReleases: "helm",
  serviceAccounts: "serviceaccounts",
  roles: "roles",
  roleBindings: "rolebindings",
};

function findingSeverityColor(severity?: string): "error" | "warning" | "info" | "default" {
  if (severity === "high") return "error";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "default";
}

function namespaceConditionChipColor(status?: string): "success" | "warning" | "error" | "default" {
  if (status === "True") return "error";
  if (status === "False") return "success";
  if (status === "Unknown") return "warning";
  return "default";
}

function isNamespaceConditionHealthy(cond: NamespaceCondition): boolean {
  return cond.status === "False";
}

function quotaGaugeColor(ratio?: number): "success" | "warning" | "error" {
  if (ratio == null) return "success";
  if (ratio >= 0.9) return "error";
  if (ratio >= 0.8) return "warning";
  return "success";
}

function quotaGaugeMuiColor(ratio?: number): string {
  const level = quotaGaugeColor(ratio);
  if (level === "error") return "#d32f2f";
  if (level === "warning") return "#ed6c02";
  return "#2e7d32";
}

function summarizeQuotaPressure(quotas: ResourceQuota[]): { critical: number; warning: number } {
  let critical = 0;
  let warning = 0;
  for (const quota of quotas) {
    for (const entry of quota.entries) {
      if (entry.ratio == null) continue;
      if (entry.ratio >= 0.9) critical++;
      else if (entry.ratio >= 0.8) warning++;
    }
  }
  return { critical, warning };
}

function findingTarget(finding: NamespaceFinding): string {
  if (!finding.name) return finding.namespace || finding.kind;
  return finding.namespace ? `${finding.namespace}/${finding.name}` : finding.name;
}

function findingNote(finding: NamespaceFinding): string {
  const parts = [finding.reason];
  if (finding.likelyCause) parts.push(`Likely cause: ${finding.likelyCause}`);
  if (finding.suggestedAction) parts.push(`Next step: ${finding.suggestedAction}`);
  return parts.join(" ");
}

function kvRowsFromMap(values?: Record<string, string>): Array<{ label: string; value: string; monospace: boolean }> {
  return Object.entries(values || {}).map(([key, value]) => ({ label: key, value, monospace: true }));
}

type HealthBarSegment = {
  label: string;
  count: number;
  color: string;
};

function mapCountChip(
  label: string,
  count: number | undefined,
  sectionKey: string,
  enabled: boolean,
  onSelect: (sectionKey: string) => void
) {
  if (!count) return null;
  return <ResourceLinkChip label={`${label}: ${count}`} onClick={enabled ? () => onSelect(sectionKey) : undefined} />;
}

function stackedHealthBar(segments: HealthBarSegment[]) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);
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

function workloadSignalSummary(rollup?: WorkloadKindHealthRollup): string {
  if (!rollup || rollup.total === 0) return "-";
  return `${rollup.healthy} ok · ${rollup.progressing} prog · ${rollup.degraded} deg / ${rollup.total}`;
}

function podHealthSummary(podHealth?: PodHealth): string {
  if (!podHealth) return "-";
  const total = podHealth.running + podHealth.pending + podHealth.failed + podHealth.succeeded + podHealth.unknown;
  if (total === 0) return "-";
  return `${podHealth.running} run · ${podHealth.pending} pend · ${podHealth.failed} fail · ${podHealth.succeeded} done · ${podHealth.unknown} unk / ${total}`;
}

function problematicSignalColor(reason: string): "warning" | "error" {
  const normalized = reason.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("deadline")) return "error";
  return "warning";
}

export default function NamespaceDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespaceName: string | null;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsErr, setInsightsErr] = useState("");
  const [insights, setInsights] = useState<NamespaceInsights | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsErr, setDetailsErr] = useState("");
  const [details, setDetails] = useState<NamespaceDetails | null>(null);
  const [detailsRequested, setDetailsRequested] = useState(false);

  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerDeployment, setDrawerDeployment] = useState<string | null>(null);
  const [drawerJob, setDrawerJob] = useState<string | null>(null);
  const [drawerHelmRelease, setDrawerHelmRelease] = useState<string | null>(null);
  const insightsCacheRef = useRef<Record<string, NamespaceInsights>>({});
  const detailsCacheRef = useRef<Record<string, NamespaceDetails>>({});

  const name = props.namespaceName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    const cachedInsights = insightsCacheRef.current[name] || null;
    setInsights(cachedInsights);
    setInsightsLoading(!cachedInsights);
    setInsightsErr("");
    setDetailsLoading(false);
    setDetailsErr("");
    const cachedDetails = detailsCacheRef.current[name] || null;
    setDetails(cachedDetails);
    setDetailsRequested(!!cachedDetails);
    setDrawerPod(null);
    setDrawerDeployment(null);
    setDrawerJob(null);
    setDrawerHelmRelease(null);

    const encodedName = encodeURIComponent(name);
    (async () => {
      const res = await apiGet<ApiItemResponse<NamespaceInsights>>(`/api/namespaces/${encodedName}/insights`, props.token);
      const item = res?.item ?? null;
      setInsights(item);
      if (item) {
        insightsCacheRef.current[name] = item;
      }
    })()
      .catch((e) => setInsightsErr(String(e)))
      .finally(() => setInsightsLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  useEffect(() => {
    if (!props.open || !name) return;
    if (tab < metadataTabIndex) return;
    if (detailsRequested || detailsLoading || details) return;

    setDetailsRequested(true);
    setDetailsLoading(true);
    setDetailsErr("");

    const encodedName = encodeURIComponent(name);
    (async () => {
      const res = await apiGet<ApiItemResponse<NamespaceDetails>>(`/api/namespaces/${encodedName}`, props.token);
      const item = res?.item ?? null;
      setDetails(item);
      if (item) {
        detailsCacheRef.current[name] = item;
      }
    })()
      .catch((e) => setDetailsErr(String(e)))
      .finally(() => setDetailsLoading(false));
  }, [props.open, name, props.token, tab, detailsRequested, detailsLoading, details]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const conditions = details?.conditions || [];

  const counts = insights?.summary?.counts;
  const podHealth = insights?.summary?.podHealth;
  const problematic = insights?.summary?.problematic || [];
  const helmReleases = insights?.summary?.helmReleases || [];
  const summaryMeta = insights?.summary?.meta;
  const workloadByKind = insights?.summary?.workloadByKind;
  const restartHotspots = insights?.summary?.restartHotspots || [];
  const findings = insights?.findings || [];
  const quotas = insights?.resourceQuotas || [];
  const limitRanges = insights?.limitRanges || [];
  const quotaPressure = summarizeQuotaPressure(quotas);
  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name || name), monospace: true },
      {
        label: "Phase",
        value: (
          <Chip
            size="small"
            label={valueOrDash(summary?.phase)}
            color={namespacePhaseChipColor(summary?.phase)}
          />
        ),
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary, name]
  );

  function navigateTo(sectionKey: string) {
    if (!props.onNavigate || !name) return;
    props.onNavigate(sectionMap[sectionKey] || sectionKey, name);
  }

  function openProblematic(resource: ProblematicResource) {
    switch (resource.kind) {
      case "Pod":
        setDrawerPod(resource.name);
        return;
      case "Deployment":
        setDrawerDeployment(resource.name);
        return;
      case "Job":
        setDrawerJob(resource.name);
        return;
      case "DaemonSet":
        navigateTo("daemonSets");
        return;
      case "StatefulSet":
        navigateTo("statefulSets");
        return;
      case "CronJob":
        navigateTo("cronJobs");
        return;
      case "ReplicaSet":
        navigateTo("replicaSets");
        return;
    }
  }

  function openFinding(finding: NamespaceFinding) {
    switch (finding.kind) {
      case "Namespace":
      case "ResourceQuota":
        setTab(2);
        return;
      case "HelmRelease":
        setDrawerHelmRelease(finding.name || null);
        return;
      case "Job":
        setDrawerJob(finding.name || null);
        return;
      case "ConfigMap":
        navigateTo("configMaps");
        return;
      case "Secret":
        navigateTo("secrets");
        return;
      case "PersistentVolumeClaim":
        navigateTo("pvcs");
        return;
      case "ServiceAccount":
        navigateTo("serviceAccounts");
        return;
      case "CronJob":
        navigateTo("cronJobs");
        return;
    }
  }

  const primaryError = insightsErr || (tab >= metadataTabIndex ? detailsErr : "");

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell title={<>Namespace: {name || "-"}</>} onClose={props.onClose}>
        {insightsLoading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : primaryError && !insights ? (
          <ErrorState message={primaryError} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, value) => setTab(value)}>
              {tabs.map((label) => (
                <Tab key={label} label={label} />
              ))}
            </Tabs>

            <Box sx={drawerBodySx}>
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <NamespaceActions token={props.token} namespaceName={name} onDeleted={props.onClose} />
                    </Section>
                  )}

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
                        color={findings.some((item) => item.severity === "high") ? "error" : findings.some((item) => item.severity === "medium") ? "warning" : "success"}
                        label={`Findings: ${findings.length}`}
                      />
                      {restartHotspots.length > 0 && (
                        <Chip
                          size="small"
                          color={restartHotspots.some((item) => item.severity === "high") ? "error" : "warning"}
                          label={`Restart hotspots: ${restartHotspots.length}`}
                        />
                      )}
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
                              onClick={() => openProblematic(resource)}
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

                  {restartHotspots.length > 0 && (
                    <Section title="Restart hotspots">
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
                          {restartHotspots.slice(0, 8).map((item) => (
                            <TableRow>
                              <TableCell>
                                <Chip size="small" label="Pod" />
                              </TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{item.name}</TableCell>
                              <TableCell>
                                <Chip size="small" color={findingSeverityColor(item.severity)} label={`${item.severity} · ${item.restarts} restarts`} />
                              </TableCell>
                              <TableCell>
                                {item.phase}
                                {item.lastEventReason ? ` · ${item.lastEventReason}` : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  )}

                  <Section title="Findings">
                    {findings.length === 0 ? (
                      <EmptyState message="No namespace findings from cached dataplane scope." />
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
                          {findings.map((finding, index) => (
                            <TableRow
                              key={`${finding.kind}-${finding.name || finding.namespace || index}`}
                              hover
                              sx={{ cursor: "pointer" }}
                              onClick={() => openFinding(finding)}
                              title={findingNote(finding)}
                            >
                              <TableCell>
                                <Chip size="small" label={finding.kind} />
                              </TableCell>
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{findingTarget(finding)}</TableCell>
                              <TableCell>
                                <Chip size="small" color={findingSeverityColor(finding.severity)} label={finding.severity} />
                              </TableCell>
                              <TableCell>{finding.reason}</TableCell>
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
              )}

              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  {counts && (
                    <>
                      <Section title="Workloads">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {mapCountChip("Pods", counts.pods, "pods", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Deployments", counts.deployments, "deployments", !!props.onNavigate, navigateTo)}
                          {mapCountChip("StatefulSets", counts.statefulSets, "statefulSets", !!props.onNavigate, navigateTo)}
                          {mapCountChip("DaemonSets", counts.daemonSets, "daemonSets", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Jobs", counts.jobs, "jobs", !!props.onNavigate, navigateTo)}
                          {mapCountChip("CronJobs", counts.cronJobs, "cronJobs", !!props.onNavigate, navigateTo)}
                        </Box>
                      </Section>

                      <Section title="Networking">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {mapCountChip("Services", counts.services, "services", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Ingresses", counts.ingresses, "ingresses", !!props.onNavigate, navigateTo)}
                          {counts.services === 0 && counts.ingresses === 0 && (
                            <Typography variant="body2" color="text.secondary">None</Typography>
                          )}
                        </Box>
                      </Section>

                      <Section title="Storage & configuration">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {mapCountChip("PVCs", counts.pvcs, "pvcs", !!props.onNavigate, navigateTo)}
                          {mapCountChip("ConfigMaps", counts.configMaps, "configMaps", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Secrets", counts.secrets, "secrets", !!props.onNavigate, navigateTo)}
                        </Box>
                      </Section>

                      <Section title="Access & packaging">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {mapCountChip("ServiceAccounts", counts.serviceAccounts, "serviceAccounts", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Roles", counts.roles, "roles", !!props.onNavigate, navigateTo)}
                          {mapCountChip("RoleBindings", counts.roleBindings, "roleBindings", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Helm releases", counts.helmReleases, "helmReleases", !!props.onNavigate, navigateTo)}
                        </Box>
                      </Section>
                    </>
                  )}

                  {helmReleases.length > 0 && (
                    <Section title="Helm releases">
                      <Table size="small" sx={{ mt: 1 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Revision</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {helmReleases.map((release) => (
                            <TableRow
                              key={release.name}
                              hover
                              sx={{ cursor: "pointer" }}
                              onClick={() => setDrawerHelmRelease(release.name)}
                            >
                              <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{release.name}</TableCell>
                              <TableCell>
                                <Chip size="small" label={release.status} color={helmStatusChipColor(release.status)} />
                              </TableCell>
                              <TableCell>{release.revision}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Section>
                  )}
                </Box>
              )}

              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Section title="Capacity signals">
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                      <Chip size="small" label={`ResourceQuotas: ${quotas.length}`} color={quotas.length > 0 ? "primary" : "default"} />
                      <Chip size="small" label={`LimitRanges: ${limitRanges.length}`} color={limitRanges.length > 0 ? "primary" : "default"} />
                      {(quotaPressure.critical > 0 || quotaPressure.warning > 0) && (
                        <>
                          <Chip size="small" color="error" label={`Critical quota entries: ${quotaPressure.critical}`} />
                          <Chip size="small" color="warning" label={`Warning quota entries: ${quotaPressure.warning}`} />
                        </>
                      )}
                    </Box>
                  </Section>

                  {quotas.length === 0 ? (
                    <EmptyState message="No ResourceQuotas in this namespace." />
                  ) : (
                    quotas.map((quota) => (
                      <Section key={quota.name} title={`ResourceQuota: ${quota.name}`}>
                        <KeyValueTable
                          rows={[
                            { label: "Name", value: quota.name, monospace: true },
                            { label: "Age", value: fmtAge(quota.ageSec) },
                          ]}
                          columns={2}
                        />
                        <Table size="small" sx={{ mt: 1.5 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ width: "30%", fontWeight: 600 }}>Resource</TableCell>
                              <TableCell sx={{ width: "50%", fontWeight: 600 }}>Usage</TableCell>
                              <TableCell sx={{ width: "20%", fontWeight: 600, textAlign: "right" }}>Used / Hard</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {quota.entries.map((entry) => {
                              const pct = entry.ratio != null ? Math.round(entry.ratio * 100) : null;
                              const color = quotaGaugeMuiColor(entry.ratio);
                              return (
                                <TableRow key={entry.key}>
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{entry.key}</TableCell>
                                  <TableCell>
                                    <Box sx={{ position: "relative", display: "flex", alignItems: "center" }}>
                                      <LinearProgress
                                        variant="determinate"
                                        value={pct != null ? Math.min(pct, 100) : 0}
                                        sx={{
                                          width: "100%",
                                          height: 20,
                                          borderRadius: 1,
                                          backgroundColor: "rgba(0,0,0,0.08)",
                                          "& .MuiLinearProgress-bar": {
                                            backgroundColor: color,
                                            borderRadius: 1,
                                          },
                                        }}
                                      />
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          position: "absolute",
                                          width: "100%",
                                          textAlign: "center",
                                          fontSize: 11,
                                          fontWeight: 600,
                                          color: pct != null && pct >= 50 ? "#fff" : "text.primary",
                                          lineHeight: "20px",
                                        }}
                                      >
                                        {pct != null ? `${pct}%` : "-"}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
                                    {entry.used} / {entry.hard}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Section>
                    ))
                  )}

                  <Section title="LimitRanges">
                    {limitRanges.length === 0 ? (
                      <EmptyState message="No LimitRanges in this namespace." />
                    ) : (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        {limitRanges.map((range) => (
                          <Box key={range.name} sx={{ border: "1px solid var(--panel-border)", borderRadius: 1, p: 1.5 }}>
                            <KeyValueTable
                              rows={[
                                { label: "Name", value: range.name, monospace: true },
                                { label: "Age", value: fmtAge(range.ageSec) },
                              ]}
                              columns={2}
                            />
                            <Table size="small" sx={{ mt: 1.5 }}>
                              <TableHead>
                                <TableRow>
                                  <TableCell>Type</TableCell>
                                  <TableCell>Min</TableCell>
                                  <TableCell>Max</TableCell>
                                  <TableCell>Default</TableCell>
                                  <TableCell>Default Request</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {range.items.map((item, index) => (
                                  <TableRow key={`${range.name}-${item.type}-${index}`}>
                                    <TableCell>{item.type}</TableCell>
                                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                                      {kvRowsFromMap(item.min).map((row) => `${row.label}=${row.value}`).join(", ") || "-"}
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                                      {kvRowsFromMap(item.max).map((row) => `${row.label}=${row.value}`).join(", ") || "-"}
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                                      {kvRowsFromMap(item.default).map((row) => `${row.label}=${row.value}`).join(", ") || "-"}
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                                      {kvRowsFromMap(item.defaultRequest).map((row) => `${row.label}=${row.value}`).join(", ") || "-"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Section>
                </Box>
              )}

              {tab === metadataTabIndex && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {detailsLoading && !details ? (
                    <Box sx={loadingCenterSx}>
                      <CircularProgress />
                    </Box>
                  ) : detailsErr ? (
                    <ErrorState message={detailsErr} />
                  ) : (
                    <>
                      <Box sx={panelBoxSx}>
                        <KeyValueTable rows={summaryItems} columns={3} />
                      </Box>
                      <ConditionsTable
                        conditions={conditions}
                        isHealthy={(condition) => isNamespaceConditionHealthy(condition as NamespaceCondition)}
                        chipColor={(condition) => namespaceConditionChipColor(condition.status)}
                        title="Namespace conditions"
                      />
                      <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />
                    </>
                  )}
                </Box>
              )}

              {tab === yamlTabIndex && (
                detailsLoading && !details ? (
                  <Box sx={loadingCenterSx}>
                    <CircularProgress />
                  </Box>
                ) : detailsErr ? (
                  <ErrorState message={detailsErr} />
                ) : (
                  <CodeBlock code={details?.yaml || ""} language="yaml" />
                )
              )}
            </Box>

            <PodDrawer
              open={!!drawerPod}
              onClose={() => setDrawerPod(null)}
              token={props.token}
              namespace={name || ""}
              podName={drawerPod}
            />
            <DeploymentDrawer
              open={!!drawerDeployment}
              onClose={() => setDrawerDeployment(null)}
              token={props.token}
              namespace={name || ""}
              deploymentName={drawerDeployment}
            />
            <JobDrawer
              open={!!drawerJob}
              onClose={() => setDrawerJob(null)}
              token={props.token}
              namespace={name || ""}
              jobName={drawerJob}
            />
            <HelmReleaseDrawer
              open={!!drawerHelmRelease}
              onClose={() => setDrawerHelmRelease(null)}
              token={props.token}
              namespace={name || ""}
              releaseName={drawerHelmRelease}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
