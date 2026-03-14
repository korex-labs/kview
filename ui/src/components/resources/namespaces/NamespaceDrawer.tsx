import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  LinearProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { namespacePhaseChipColor, helmStatusChipColor } from "../../../utils/k8sUi";
import type { ChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import AccessDeniedState from "../../shared/AccessDeniedState";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import CodeBlock from "../../shared/CodeBlock";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import PodDrawer from "../pods/PodDrawer";
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import JobDrawer from "../jobs/JobDrawer";
import HelmReleaseDrawer from "../helm/HelmReleaseDrawer";
import NamespaceActions from "./NamespaceActions";
import RightDrawer from "../../layout/RightDrawer";

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

type NamespaceSummaryResources = {
  counts: ResourceCounts;
  podHealth: PodHealth;
  deploymentHealth: DeploymentHealth;
  problematic: ProblematicResource[];
  helmReleases?: NamespaceHelmRelease[];
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
  helmReleases: number;
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

function isNamespaceConditionHealthy(cond: NamespaceCondition): boolean {
  return cond.status === "False";
}

function namespaceConditionChipColor(status?: string): "success" | "warning" | "error" | "default" {
  if (status === "True") return "error";
  if (status === "False") return "success";
  if (status === "Unknown") return "warning";
  return "default";
}

function quotaGaugeColor(ratio?: number): "success" | "warning" | "error" {
  if (ratio == null) return "success";
  if (ratio >= 0.9) return "error";
  if (ratio >= 0.7) return "warning";
  return "success";
}

function quotaGaugeMuiColor(ratio?: number): string {
  const level = quotaGaugeColor(ratio);
  if (level === "error") return "#d32f2f";
  if (level === "warning") return "#ed6c02";
  return "#2e7d32";
}

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
};

export default function NamespaceDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespaceName: string | null;
  onNavigate?: (section: string, namespace: string) => void;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<NamespaceDetails | null>(null);
  const [err, setErr] = useState("");
  const [summaryRes, setSummaryRes] = useState<NamespaceSummaryResources | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [quotas, setQuotas] = useState<ResourceQuota[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(false);
  const [quotasErr, setQuotasErr] = useState("");
  const [quotasForbidden, setQuotasForbidden] = useState(false);

  // nested drawer state
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerDeployment, setDrawerDeployment] = useState<string | null>(null);
  const [drawerJob, setDrawerJob] = useState<string | null>(null);
  const [drawerHelmRelease, setDrawerHelmRelease] = useState<string | null>(null);

  const name = props.namespaceName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setSummaryRes(null);
    setLoading(true);
    setSummaryLoading(true);
    setDrawerPod(null);
    setDrawerDeployment(null);
    setDrawerJob(null);
    setDrawerHelmRelease(null);
    setQuotas([]);
    setQuotasErr("");
    setQuotasForbidden(false);
    setQuotasLoading(true);

    const encodedName = encodeURIComponent(name);

    (async () => {
      const det = await apiGet<any>(`/api/namespaces/${encodedName}`, props.token);
      const item: NamespaceDetails | null = det?.item ?? null;
      setDetails(item);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));

    (async () => {
      const res = await apiGet<any>(`/api/namespaces/${encodedName}/summary`, props.token);
      const item: NamespaceSummaryResources | null = res?.item ?? null;
      setSummaryRes(item);
    })()
      .catch(() => {})
      .finally(() => setSummaryLoading(false));

    (async () => {
      const res = await apiGet<any>(`/api/namespaces/${encodedName}/resourcequotas`, props.token);
      setQuotas(res?.items ?? []);
    })()
      .catch((e: any) => {
        const status = e?.status;
        if (status === 403 || status === 401) {
          setQuotasForbidden(true);
        } else {
          setQuotasErr(String(e));
        }
      })
      .finally(() => setQuotasLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const conditions = details?.conditions || [];

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Phase",
        value: (
          <Chip size="small" label={valueOrDash(summary?.phase)} color={namespacePhaseChipColor(summary?.phase)} />
        ),
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );

  const counts = summaryRes?.counts;
  const podHealth = summaryRes?.podHealth;
  const deployHealth = summaryRes?.deploymentHealth;
  const problematic = summaryRes?.problematic || [];
  const helmReleases = summaryRes?.helmReleases || [];

  function navigateTo(sectionKey: string) {
    if (props.onNavigate && name) {
      const sec = sectionMap[sectionKey] || sectionKey;
      props.onNavigate(sec, name);
    }
  }

  function openProblematic(r: ProblematicResource) {
    switch (r.kind) {
      case "Pod":
        setDrawerPod(r.name);
        return;
      case "Deployment":
        setDrawerDeployment(r.name);
        return;
      case "Job":
        setDrawerJob(r.name);
        return;
    }
  }

  function countChip(label: string, count: number, sectionKey: string) {
    if (count === 0) return null;
    return (
      <ResourceLinkChip
        label={`${label}: ${count}`}
        onClick={props.onNavigate ? () => navigateTo(sectionKey) : undefined}
      />
    );
  }

  function healthChip(label: string, count: number, color: ChipColor) {
    if (count === 0) return null;
    return <Chip size="small" label={`${label}: ${count}`} color={color} />;
  }

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Namespace: {name || "-"}
          </Typography>
          <IconButton onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ my: 1 }} />

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Conditions" />
              <Tab label="ResourceQuotas" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <NamespaceActions
                        token={props.token}
                        namespaceName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />

                  {/* RESOURCE COUNTS */}
                  {summaryLoading ? (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : counts ? (
                    <>
                      <Section title="Workloads">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {countChip("Pods", counts.pods, "pods")}
                          {countChip("Deployments", counts.deployments, "deployments")}
                          {countChip("StatefulSets", counts.statefulSets, "statefulSets")}
                          {countChip("DaemonSets", counts.daemonSets, "daemonSets")}
                          {countChip("Jobs", counts.jobs, "jobs")}
                          {countChip("CronJobs", counts.cronJobs, "cronJobs")}
                        </Box>
                      </Section>

                      <Section title="Networking">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {countChip("Services", counts.services, "services")}
                          {countChip("Ingresses", counts.ingresses, "ingresses")}
                          {counts.services === 0 && counts.ingresses === 0 && (
                            <Typography variant="body2" color="text.secondary">None</Typography>
                          )}
                        </Box>
                      </Section>

                      <Section title="Storage & Configuration">
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                          {countChip("PVCs", counts.pvcs, "pvcs")}
                          {countChip("ConfigMaps", counts.configMaps, "configMaps")}
                          {countChip("Secrets", counts.secrets, "secrets")}
                        </Box>
                      </Section>

                      {counts.helmReleases > 0 && (
                        <Section title="Helm">
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                            {countChip("Releases", counts.helmReleases, "helmReleases")}
                          </Box>
                        </Section>
                      )}

                      {/* HEALTH */}
                      {podHealth && (podHealth.running > 0 || podHealth.pending > 0 || podHealth.failed > 0 || podHealth.succeeded > 0 || podHealth.unknown > 0) && (
                        <Section title="Pod Health">
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                            {healthChip("Running", podHealth.running, "success")}
                            {healthChip("Pending", podHealth.pending, "warning")}
                            {healthChip("Failed", podHealth.failed, "error")}
                            {healthChip("Succeeded", podHealth.succeeded, "default")}
                            {healthChip("Unknown", podHealth.unknown, "warning")}
                          </Box>
                        </Section>
                      )}

                      {deployHealth && (deployHealth.healthy > 0 || deployHealth.degraded > 0 || deployHealth.progressing > 0) && (
                        <Section title="Deployment Health">
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                            {healthChip("Healthy", deployHealth.healthy, "success")}
                            {healthChip("Degraded", deployHealth.degraded, "error")}
                            {healthChip("Progressing", deployHealth.progressing, "warning")}
                          </Box>
                        </Section>
                      )}

                      {/* PROBLEMATIC RESOURCES */}
                      {problematic.length > 0 && (
                        <Section title="Problematic Resources">
                          <Table size="small" sx={{ mt: 1 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Kind</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Reason</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {problematic.map((r, i) => (
                                <TableRow
                                  key={`${r.kind}-${r.name}-${i}`}
                                  hover
                                  sx={{ cursor: "pointer" }}
                                  onClick={() => openProblematic(r)}
                                >
                                  <TableCell>
                                    <Chip size="small" label={r.kind} color="default" />
                                  </TableCell>
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{r.name}</TableCell>
                                  <TableCell>
                                    <Chip size="small" label={r.reason} color="error" />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Section>
                      )}

                      {/* HELM RELEASES */}
                      {helmReleases.length > 0 && (
                        <Section title="Helm Releases">
                          <Table size="small" sx={{ mt: 1 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Revision</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {helmReleases.map((r) => (
                                <TableRow
                                  key={r.name}
                                  hover
                                  sx={{ cursor: "pointer" }}
                                  onClick={() => setDrawerHelmRelease(r.name)}
                                >
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{r.name}</TableCell>
                                  <TableCell>
                                    <Chip size="small" label={r.status} color={helmStatusChipColor(r.status)} />
                                  </TableCell>
                                  <TableCell>{r.revision}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Section>
                      )}
                    </>
                  ) : null}
                </Box>
              )}

              {/* CONDITIONS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <ConditionsTable
                    conditions={conditions}
                    isHealthy={isNamespaceConditionHealthy}
                    chipColor={(cond) => namespaceConditionChipColor(cond.status)}
                    title="Namespace Conditions"
                  />
                </Box>
              )}

              {/* RESOURCE QUOTAS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {quotasLoading ? (
                    <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : quotasForbidden ? (
                    <AccessDeniedState status={403} resourceLabel="resource quotas" />
                  ) : quotasErr ? (
                    <ErrorState message={quotasErr} />
                  ) : quotas.length === 0 ? (
                    <EmptyState message="No ResourceQuotas in this namespace." />
                  ) : (
                    quotas.map((rq) => (
                      <Section key={rq.name} title={`ResourceQuota: ${rq.name}`}>
                        <KeyValueTable
                          rows={[
                            { label: "Name", value: rq.name, monospace: true },
                            { label: "Age", value: fmtAge(rq.ageSec) },
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
                            {rq.entries.map((entry) => {
                              const pct = entry.ratio != null ? Math.round(entry.ratio * 100) : null;
                              const color = quotaGaugeMuiColor(entry.ratio);
                              return (
                                <TableRow key={entry.key}>
                                  <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>
                                    {entry.key}
                                  </TableCell>
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
                </Box>
              )}

              {/* YAML */}
              {tab === 3 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
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
      </Box>
    </RightDrawer>
  );
}
