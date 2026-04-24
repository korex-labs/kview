import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
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
import type {
  ApiItemResponse,
  ApiListResponse,
  DashboardSignalItem,
  EventDTO,
  LimitRangeItem,
  NamespaceCondition,
  NamespaceDeploymentHealth,
  NamespaceDetails,
  NamespaceHelmRelease,
  NamespaceInsights,
  NamespaceLimitRange,
  NamespaceMetadata,
  NamespaceResourceCounts,
  NamespaceResourceQuota,
  NamespaceResourceSignals,
  NamespaceSummary,
  NamespaceSummaryMeta,
  NamespaceSummaryResources,
  NamespaceWorkloadHealthRollup,
  ResourceQuotaEntry,
} from "../../../types/api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, valueOrDash } from "../../../utils/format";
import {
  helmStatusChipColor,
  namespacePhaseChipColor,
  formatChipLabel,
} from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import ConditionsTable from "../../shared/ConditionsTable";
import CodeBlock from "../../shared/CodeBlock";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import MetadataSection from "../../shared/MetadataSection";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import { formatCPUMilli, formatMemoryBytes } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import RightDrawer from "../../layout/RightDrawer";
import Section from "../../shared/Section";
import EventsList from "../../shared/EventsList";
import NamespaceSignalsTab from "./NamespaceSignalsTab";
import PodDrawer from "../pods/PodDrawer";
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import JobDrawer from "../jobs/JobDrawer";
import HelmReleaseDrawer from "../helm/HelmReleaseDrawer";
import { drawerBodySx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";

const tabs = ["Signals", "Inventory", "Capacity", "Events", "Metadata", "YAML"] as const;
const eventsTabIndex = tabs.indexOf("Events");
const metadataTabIndex = tabs.indexOf("Metadata");
const yamlTabIndex = tabs.indexOf("YAML");

const sectionMap: Record<string, string> = {
  pods: "pods",
  deployments: "deployments",
  statefulSets: "statefulsets",
  daemonSets: "daemonsets",
  jobs: "jobs",
  cronJobs: "cronjobs",
  horizontalPodAutoscalers: "horizontalpodautoscalers",
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

function signalSeverityColor(severity?: string): "error" | "warning" | "info" | "default" {
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

function quotaGaugeTone(ratio?: number): GaugeTone {
  if (ratio == null) return "success";
  if (ratio >= 0.9) return "error";
  if (ratio >= 0.8) return "warning";
  return "success";
}

function summarizeQuotaPressure(quotas: NamespaceResourceQuota[]): { critical: number; warning: number } {
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

function signalNote(signal: DashboardSignalItem): string {
  const actual = signal.actualData || signal.reason;
  const parts = [actual];
  if (signal.calculatedData && signal.calculatedData !== actual) parts.push(`Calculated: ${signal.calculatedData}`);
  if (signal.likelyCause) parts.push(`Likely cause: ${signal.likelyCause}`);
  if (signal.suggestedAction) parts.push(`Next step: ${signal.suggestedAction}`);
  return parts.join(" ");
}

function resourceSignalKey(kind: string, name: string, scope = "namespace", scopeLocation = ""): string {
  return `${scope}/${scopeLocation}/${kind}/${name}`;
}

function buildResourceSignalMap(groups?: NamespaceResourceSignals[]): Map<string, DashboardSignalItem[]> {
  const out = new Map<string, DashboardSignalItem[]>();
  for (const group of groups || []) {
    out.set(resourceSignalKey(group.resourceKind, group.resourceName, group.scope || "namespace", group.scopeLocation || ""), group.signals || []);
  }
  return out;
}

function resourceSignalsFor(
  groups: Map<string, DashboardSignalItem[]>,
  kind: string,
  name: string,
  namespace: string
): DashboardSignalItem[] {
  return groups.get(resourceSignalKey(kind, name, "namespace", namespace)) || [];
}

function worstSignalSeverity(signals: DashboardSignalItem[]): string {
  if (signals.some((signal) => signal.severity === "high")) return "high";
  if (signals.some((signal) => signal.severity === "medium")) return "medium";
  if (signals.some((signal) => signal.severity === "low")) return "low";
  return "";
}


function ResourceSignalsChip({ signals, label }: { signals: DashboardSignalItem[]; label?: string }) {
  if (signals.length === 0) return null;
  const severity = worstSignalSeverity(signals);
  const chipLabel = label || (severity ? formatChipLabel(severity) : "Signals");
  return (
    <Tooltip title={signals.map(signalNote).join(" ")}>
      <ScopedCountChip size="small" color={signalSeverityColor(severity)} label={chipLabel} count={signals.length} />
    </Tooltip>
  );
}

function kvRowsFromMap(values?: Record<string, string>): Array<{ label: string; value: string; monospace: boolean }> {
  return Object.entries(values || {}).map(([key, value]) => ({ label: key, value, monospace: true }));
}

function mapCountChip(
  label: string,
  count: number | undefined,
  sectionKey: string,
  enabled: boolean,
  onSelect: (sectionKey: string) => void
) {
  if (!count) return null;
  return (
    <ResourceLinkChip
      label={label}
      count={count}
      color={enabled ? "primary" : "default"}
      onClick={enabled ? () => onSelect(sectionKey) : undefined}
    />
  );
}

export default function NamespaceDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespaceName: string | null;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const { health, retryNonce } = useConnectionState();
  const offline = health === "unhealthy";
  const metricsStatus = useMetricsStatus(props.token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const [tab, setTab] = useState(0);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsErr, setInsightsErr] = useState("");
  const [insights, setInsights] = useState<NamespaceInsights | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsErr, setDetailsErr] = useState("");
  const [details, setDetails] = useState<NamespaceDetails | null>(null);
  const [detailsRequested, setDetailsRequested] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState("");
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [eventsRequested, setEventsRequested] = useState(false);

  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerDeployment, setDrawerDeployment] = useState<string | null>(null);
  const [drawerJob, setDrawerJob] = useState<string | null>(null);
  const [drawerHelmRelease, setDrawerHelmRelease] = useState<string | null>(null);
  const insightsCacheRef = useRef<Record<string, NamespaceInsights>>({});
  const detailsCacheRef = useRef<Record<string, NamespaceDetails>>({});
  const eventsCacheRef = useRef<Record<string, EventDTO[]>>({});

  const name = props.namespaceName;

  useEffect(() => {
    if (!props.open || !name || offline) return;

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
    setEventsLoading(false);
    setEventsErr("");
    const cachedEvents = eventsCacheRef.current[name] || [];
    setEvents(cachedEvents);
    setEventsRequested(!!eventsCacheRef.current[name]);
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
      .catch((e) => {
        if (!insightsCacheRef.current[name]) setInsightsErr(String(e));
      })
      .finally(() => setInsightsLoading(false));
  }, [props.open, name, props.token, retryNonce, offline]);

  useEffect(() => {
    if (!props.open || !name || offline) return;
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
      .catch((e) => {
        if (!detailsCacheRef.current[name]) setDetailsErr(String(e));
      })
      .finally(() => setDetailsLoading(false));
  }, [props.open, name, props.token, tab, detailsRequested, detailsLoading, details, offline]);

  useEffect(() => {
    if (!props.open || !name || offline) return;
    if (tab !== eventsTabIndex) return;
    if (eventsRequested || eventsLoading) return;

    setEventsRequested(true);
    setEventsLoading(true);
    setEventsErr("");

    const encodedName = encodeURIComponent(name);
    (async () => {
      const res = await apiGet<ApiListResponse<EventDTO>>(`/api/namespaces/${encodedName}/events`, props.token);
      const items = res?.items || [];
      setEvents(items);
      eventsCacheRef.current[name] = items;
    })()
      .catch((e) => {
        if (!eventsCacheRef.current[name]) setEventsErr(String(e));
      })
      .finally(() => setEventsLoading(false));
  }, [props.open, name, props.token, tab, eventsRequested, eventsLoading, offline]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const conditions = details?.conditions || [];

  const counts = insights?.summary?.counts;
  const podHealth = insights?.summary?.podHealth;
  const problematic = insights?.summary?.problematic || [];
  const helmReleases = insights?.summary?.helmReleases || [];
  const summaryMeta = insights?.summary?.meta;
  const workloadByKind = insights?.summary?.workloadByKind;
  const signals = insights?.signals || [];
  const resourceSignalMap = useMemo(() => buildResourceSignalMap(insights?.resourceSignals), [insights?.resourceSignals]);
  const quotas = insights?.resourceQuotas || [];
  const limitRanges = insights?.limitRanges || [];
  const resourceUsage = insights?.resourceUsage;
  const quotaPressure = summarizeQuotaPressure(quotas);
  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name || name), monospace: true },
      {
        label: "Phase",
        value: (
          <StatusChip label={valueOrDash(summary?.phase)} color={namespacePhaseChipColor(summary?.phase)} />
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
              {tab === 0 && name && (
                <NamespaceSignalsTab
                  token={props.token}
                  namespaceName={name}
                  workloadByKind={workloadByKind}
                  podHealth={podHealth}
                  signals={signals}
                  problematic={problematic}
                  summaryMeta={summaryMeta}
                  quotaPressure={quotaPressure}
                  onClose={props.onClose}
                  onOpenPod={setDrawerPod}
                  onOpenDeployment={setDrawerDeployment}
                  onOpenJob={setDrawerJob}
                  onOpenHelmRelease={setDrawerHelmRelease}
                  onNavigate={navigateTo}
                  onSelectCapacityTab={() => setTab(2)}
                  onJumpToEvents={() => setTab(eventsTabIndex)}
                  onJumpToConditions={() => setTab(metadataTabIndex)}
                />
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
                          {mapCountChip("DaemonSets", counts.daemonSets, "daemonsets", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Jobs", counts.jobs, "jobs", !!props.onNavigate, navigateTo)}
                          {mapCountChip("CronJobs", counts.cronJobs, "cronjobs", !!props.onNavigate, navigateTo)}
                          {mapCountChip("HPA", counts.horizontalPodAutoscalers, "horizontalPodAutoscalers", !!props.onNavigate, navigateTo)}
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
                          {mapCountChip("PVCs", counts.pvcs, "persistentvolumeclaims", !!props.onNavigate, navigateTo)}
                          {mapCountChip("ConfigMaps", counts.configMaps, "configmaps", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Secrets", counts.secrets, "secrets", !!props.onNavigate, navigateTo)}
                        </Box>
                      </Section>

                      <Section title="Access & packaging">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {mapCountChip("ServiceAccounts", counts.serviceAccounts, "serviceaccounts", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Roles", counts.roles, "roles", !!props.onNavigate, navigateTo)}
                          {mapCountChip("RoleBindings", counts.roleBindings, "rolebindings", !!props.onNavigate, navigateTo)}
                          {mapCountChip("Helm releases", counts.helmReleases, "helm", !!props.onNavigate, navigateTo)}
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
                            <TableCell>Signals</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {helmReleases.map((release) => {
                            const releaseSignals = resourceSignalsFor(resourceSignalMap, "HelmRelease", release.name, name || "");
                            return (
                              <TableRow
                                key={release.name}
                                hover
                                sx={{ cursor: "pointer" }}
                                onClick={() => setDrawerHelmRelease(release.name)}
                              >
                                <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{release.name}</TableCell>
                                <TableCell>
                                  <StatusChip size="small" label={release.status} color={helmStatusChipColor(release.status)} />
                                </TableCell>
                                <TableCell>{release.revision}</TableCell>
                                <TableCell>
                                  <ResourceSignalsChip signals={releaseSignals} />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Section>
                  )}
                </Box>
              )}

              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {metricsUsable && resourceUsage ? (
                    <Section title="Resource usage">
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                        <ScopedCountChip size="small" variant="outlined" label="Pods sampled" count={resourceUsage.pods} />
                        {resourceUsage.observedAt ? (
                          <Chip size="small" variant="outlined" label={`Observed ${fmtAge(Math.max(0, Math.round((Date.now() - resourceUsage.observedAt) / 1000)))} ago`} />
                        ) : null}
                      </Box>
                      <Box sx={{ mt: 1 }}>
                        <KeyValueTable
                          columns={2}
                          rows={[
                            { label: "CPU", value: formatCPUMilli(resourceUsage.cpuMilli) || "—" },
                            { label: "Memory", value: formatMemoryBytes(resourceUsage.memoryBytes) || "—" },
                          ]}
                        />
                      </Box>
                    </Section>
                  ) : null}

                  <Section title="Capacity signals">
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                      <ScopedCountChip size="small" label="ResourceQuotas" count={quotas.length} color={quotas.length > 0 ? "primary" : "default"} />
                      <ScopedCountChip size="small" label="LimitRanges" count={limitRanges.length} color={limitRanges.length > 0 ? "primary" : "default"} />
                      {(quotaPressure.critical > 0 || quotaPressure.warning > 0) && (
                        <>
                          <ScopedCountChip size="small" color="error" label="Critical quota entries" count={quotaPressure.critical} />
                          <ScopedCountChip size="small" color="warning" label="Warning quota entries" count={quotaPressure.warning} />
                        </>
                      )}
                    </Box>
                  </Section>

                  {quotas.length === 0 ? (
                    <EmptyState message="No ResourceQuotas in this namespace." />
                  ) : (
                    quotas.map((quota) => {
                      return (
                        <Section
                          key={quota.name}
                          title={`ResourceQuota: ${quota.name}`}
                        >
                          <KeyValueTable
                            rows={[
                              { label: "Name", value: quota.name, monospace: true },
                              { label: "Age", value: fmtAge(quota.ageSec) },
                            ]}
                            columns={2}
                          />
                          <Box sx={{ mt: 1.5 }}>
                              {quota.entries.map((entry) => {
                                const pct = entry.ratio != null ? Math.round(entry.ratio * 100) : null;
                                const tone = quotaGaugeTone(entry.ratio);
                                return (
                                  <GaugeTableRow
                                    key={entry.key}
                                    label={entry.key}
                                    bar={<GaugeBar value={pct ?? 0} tone={tone} />}
                                    summary={pct != null ? `${pct}% · ${entry.used} / ${entry.hard}` : `${entry.used} / ${entry.hard}`}
                                  />
                                );
                              })}
                          </Box>
                        </Section>
                      );
                    })
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

              {tab === eventsTabIndex && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {eventsLoading ? (
                    <Box sx={loadingCenterSx}>
                      <CircularProgress />
                    </Box>
                  ) : eventsErr ? (
                    <ErrorState message={eventsErr} />
                  ) : (
                    <Section title="Namespace events">
                      <EventsList events={events} emptyMessage="No events found in this namespace." showTarget />
                    </Section>
                  )}
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
                  <ResourceYamlPanel
                    code={details?.yaml || ""}
                    token={props.token}
                    target={{
                      kind: "Namespace",
                      group: "",
                      resource: "namespaces",
                      apiVersion: "v1",
                      name: name || "",
                    }}
                  />
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
