import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  CircularProgress,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { apiGet } from "../../../api";
import { fmtTs, valueOrDash } from "../../../utils/format";
import { helmStatusChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import Section from "../../shared/Section";
import AttentionSummary from "../../shared/AttentionSummary";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import HelmReleaseDrawer from "./HelmReleaseDrawer";
import { drawerBodySx, drawerTabContentSx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";
import type { ApiItemResponse, DashboardSignalItem, HelmChart, HelmChartDeployment, HelmChartVersion } from "../../../types/api";

type HelmReleaseManifestDetails = {
  manifest?: string;
};

const tableCellWrapSx = {
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  whiteSpace: "normal",
};

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
  const [releaseDrawer, setReleaseDrawer] = useState<HelmChartDeployment | null>(null);
  const [detail, setDetail] = useState<HelmChart | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [selectedVersionKey, setSelectedVersionKey] = useState("");
  const [selectedDeploymentKey, setSelectedDeploymentKey] = useState("");
  const [releaseManifestByKey, setReleaseManifestByKey] = useState<Record<string, string>>({});
  const [releaseManifestLoadingKey, setReleaseManifestLoadingKey] = useState("");
  const [releaseManifestErr, setReleaseManifestErr] = useState("");
  const displayChart = detail || chart;

  useEffect(() => {
    if (!props.open || !chart?.chartName) return;
    let cancelled = false;
    setDetail(null);
    setDetailErr("");
    setLoadingDetail(true);
    setSelectedVersionKey("");
    setSelectedDeploymentKey("");
    setReleaseManifestByKey({});
    setReleaseManifestLoadingKey("");
    setReleaseManifestErr("");

    apiGet<ApiItemResponse<HelmChart>>(
      `/api/helmcharts/${encodeURIComponent(chart.chartName)}`,
      props.token,
    )
      .then((res) => {
        if (!cancelled) setDetail(res.item || null);
      })
      .catch((e) => {
        if (!cancelled) setDetailErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, chart?.chartName, props.token]);

  const versions = useMemo<HelmChartVersion[]>(() => {
    if (!displayChart) return [];
    if (displayChart.versions?.length) return displayChart.versions;
    if (!displayChart.chartVersion && !displayChart.appVersion) return [];
    return [{
      chartVersion: displayChart.chartVersion,
      appVersion: displayChart.appVersion,
      releases: displayChart.releases,
      namespaces: displayChart.namespaces,
      statuses: displayChart.statuses,
      needsAttention: displayChart.needsAttention,
    }];
  }, [displayChart]);
  const namespaces = displayChart?.namespaces || [];
  const statuses = displayChart?.statuses || [];
  const selectedVersion = useMemo(() => {
    if (versions.length === 0) return null;
    return versions.find((version) => versionKey(version) === selectedVersionKey) || versions[0];
  }, [versions, selectedVersionKey]);
  const deployments = useMemo(
    () => selectedVersion?.deployments || [],
    [selectedVersion],
  );
  const selectedDeployment = useMemo(() => {
    if (deployments.length === 0) return null;
    return deployments.find((deployment) => deploymentKey(deployment) === selectedDeploymentKey) || deployments[0];
  }, [deployments, selectedDeploymentKey]);
  const selectedDeploymentResolvedKey = selectedDeployment ? deploymentKey(selectedDeployment) : "";
  const selectedDeploymentManifest = selectedDeployment
    ? selectedDeployment.manifest || releaseManifestByKey[selectedDeploymentResolvedKey] || ""
    : "";
  const selectedManifestLoading = !!selectedDeploymentResolvedKey && releaseManifestLoadingKey === selectedDeploymentResolvedKey;

  useEffect(() => {
    if (!selectedVersion && selectedVersionKey) setSelectedVersionKey("");
    if (selectedVersion && selectedVersionKey !== versionKey(selectedVersion)) {
      setSelectedVersionKey(versionKey(selectedVersion));
    }
  }, [selectedVersion, selectedVersionKey]);

  useEffect(() => {
    if (!selectedDeployment && selectedDeploymentKey) setSelectedDeploymentKey("");
    if (selectedDeployment && selectedDeploymentKey !== deploymentKey(selectedDeployment)) {
      setSelectedDeploymentKey(deploymentKey(selectedDeployment));
    }
  }, [selectedDeployment, selectedDeploymentKey]);

  useEffect(() => {
    setReleaseManifestErr("");
  }, [selectedDeploymentResolvedKey]);

  useEffect(() => {
    if (!props.open || tab !== 1 || !selectedDeployment || !selectedDeploymentResolvedKey) return;
    if (selectedDeployment.manifest?.trim()) return;
    if (releaseManifestByKey[selectedDeploymentResolvedKey] !== undefined) return;

    let cancelled = false;
    setReleaseManifestErr("");
    setReleaseManifestLoadingKey(selectedDeploymentResolvedKey);

    apiGet<ApiItemResponse<HelmReleaseManifestDetails>>(
      `/api/namespaces/${encodeURIComponent(selectedDeployment.namespace)}/helmreleases/${encodeURIComponent(selectedDeployment.name)}`,
      props.token,
    )
      .then((res) => {
        if (cancelled) return;
        setReleaseManifestByKey((prev) => ({
          ...prev,
          [selectedDeploymentResolvedKey]: res.item?.manifest || "",
        }));
      })
      .catch((e) => {
        if (!cancelled) setReleaseManifestErr(String(e));
      })
      .finally(() => {
        if (!cancelled) {
          setReleaseManifestLoadingKey((current) => current === selectedDeploymentResolvedKey ? "" : current);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [props.open, props.token, releaseManifestByKey, selectedDeployment, selectedDeploymentResolvedKey, tab]);

  const chartSignals = useMemo<DashboardSignalItem[]>(
    () => (displayChart ? chartSignalSummary(displayChart, versions) : []),
    [displayChart, versions],
  );

  const summaryItems = useMemo(
    () =>
      displayChart
        ? [
            { label: "Chart", value: valueOrDash(displayChart.chartName), monospace: true },
            { label: "Versions", value: versions.length > 1 ? String(versions.length) : valueOrDash(displayChart.chartVersion) },
            { label: "App Version", value: versions.length > 1 ? "multiple" : valueOrDash(displayChart.appVersion) },
            { label: "Releases", value: String(displayChart.releases) },
            { label: "Namespaces", value: String(namespaces.length) },
            { label: "Source", value: displayChart.derived ? "Derived" : "Direct" },
            { label: "Signals", value: String(displayChart.needsAttention || 0) },
          ]
        : [],
    [displayChart, namespaces.length, versions.length],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        resourceIcon="helmcharts"
        title={<>Helm Chart: {displayChart?.chartName || chart?.chartName || "-"}</>}
        resourceIdentity={{ resource: "helmcharts", name: displayChart?.chartName || chart?.chartName }}
        onClose={props.onClose}
      >
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

                  <AttentionSummary token={props.token} signals={chartSignals} />

                  {detailErr ? (
                    <ErrorState message={`Chart detail unavailable: ${detailErr}`} />
                  ) : null}

                  {displayChart?.derived ? (
                    <Section title="Derived Projection">
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          <StatusChip size="small" color="warning" variant="outlined" label="Derived" />
                          {displayChart.derivedSource ? <ScopedCountChip size="small" variant="outlined" label="Source" count={displayChart.derivedSource} /> : null}
                          {displayChart.derivedCoverage ? <ScopedCountChip size="small" variant="outlined" label="Coverage" count={displayChart.derivedCoverage} /> : null}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {displayChart.derivedNote || "This chart row is inferred from cached Helm release snapshots."}
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
                <Box sx={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 2, height: "100%", minWidth: 0, overflow: "hidden" }}>
                  {loadingDetail ? (
                    <Box sx={loadingCenterSx}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : versions.length === 0 ? (
                    <EmptyState message="No chart versions found." />
                  ) : (
                    <>
                      <Box sx={{ minWidth: 0, overflow: "auto", maxHeight: 220 }}>
                        <Table size="small" stickyHeader sx={{ tableLayout: "fixed", width: "100%" }}>
                          <TableHead>
                            <TableRow>
                              <TableCell sx={tableCellWrapSx}>Version</TableCell>
                              <TableCell sx={tableCellWrapSx}>App Version</TableCell>
                              <TableCell sx={{ width: 82 }}>Releases</TableCell>
                              <TableCell sx={{ width: 98 }}>Namespaces</TableCell>
                              <TableCell sx={tableCellWrapSx}>Statuses</TableCell>
                              <TableCell sx={{ width: 96 }}>Signals</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {versions.map((version) => {
                              const key = versionKey(version);
                              const selected = selectedVersion ? key === versionKey(selectedVersion) : false;
                              return (
                                <TableRow
                                  key={key}
                                  hover
                                  selected={selected}
                                  onClick={() => {
                                    setSelectedVersionKey(key);
                                    setSelectedDeploymentKey("");
                                  }}
                                  sx={{ cursor: "pointer" }}
                                >
                                  <TableCell sx={tableCellWrapSx}>{valueOrDash(version.chartVersion)}</TableCell>
                                  <TableCell sx={tableCellWrapSx}>{valueOrDash(version.appVersion)}</TableCell>
                                  <TableCell>{version.releases}</TableCell>
                                  <TableCell>{version.namespaces?.length || 0}</TableCell>
                                  <TableCell sx={tableCellWrapSx}>{(version.statuses || []).join(", ") || "-"}</TableCell>
                                  <TableCell sx={tableCellWrapSx}>
                                    {version.needsAttention ? (
                                      <ScopedCountChip size="small" color="warning" label="Releases" count={version.needsAttention} />
                                    ) : "-"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Box>

                      <Box sx={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 1.5, minHeight: 0, minWidth: 0 }}>
                        <Section title={`Version ${valueOrDash(selectedVersion?.chartVersion)}`}>
                          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, mt: 0.5, minWidth: 0 }}>
                            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                              {(selectedVersion?.namespaces || []).map((ns) => (
                                <ResourceLinkChip key={ns} label={ns} onClick={() => setDrawerNamespace(ns)} />
                              ))}
                            </Box>
                            {deployments.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                Exact release deployment rows are unavailable for this chart version. Open Helm Releases for release-level manifests.
                              </Typography>
                            ) : (
                              <Box sx={{ minWidth: 0, overflow: "auto", maxHeight: 180 }}>
                                <Table size="small" stickyHeader sx={{ tableLayout: "fixed", width: "100%" }}>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell sx={tableCellWrapSx}>Release</TableCell>
                                      <TableCell sx={tableCellWrapSx}>Namespace</TableCell>
                                      <TableCell sx={tableCellWrapSx}>Status</TableCell>
                                      <TableCell sx={{ width: 76 }}>Revision</TableCell>
                                      <TableCell sx={tableCellWrapSx}>Updated</TableCell>
                                      <TableCell sx={{ width: 86 }}>Manifest</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {deployments.map((deployment) => {
                                      const key = deploymentKey(deployment);
                                      const selected = selectedDeployment ? key === deploymentKey(selectedDeployment) : false;
                                      return (
                                        <TableRow
                                          key={key}
                                          hover
                                          selected={selected}
                                          onClick={() => setSelectedDeploymentKey(key)}
                                          sx={{ cursor: "pointer" }}
                                        >
                                          <TableCell sx={tableCellWrapSx}>
                                            <ResourceLinkChip label={deployment.name} onClick={() => setReleaseDrawer(deployment)} />
                                          </TableCell>
                                          <TableCell sx={tableCellWrapSx}>
                                            <ResourceLinkChip label={deployment.namespace} onClick={() => setDrawerNamespace(deployment.namespace)} />
                                          </TableCell>
                                          <TableCell sx={tableCellWrapSx}>
                                            <StatusChip size="small" label={valueOrDash(deployment.status)} color={helmStatusChipColor(deployment.status)} />
                                          </TableCell>
                                          <TableCell>{valueOrDash(deployment.revision)}</TableCell>
                                          <TableCell sx={tableCellWrapSx}>{deployment.updated ? fmtTs(deployment.updated) : "-"}</TableCell>
                                          <TableCell>
                                            {deployment.manifest?.trim() || releaseManifestByKey[key]?.trim()
                                              ? "available"
                                              : selected && releaseManifestLoadingKey === key
                                                ? "loading"
                                                : "-"}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </Box>
                            )}
                          </Box>
                        </Section>

                        <Box sx={{ minHeight: 0, minWidth: 0, overflow: "hidden" }}>
                          {selectedManifestLoading ? (
                            <Box sx={loadingCenterSx}>
                              <CircularProgress size={24} />
                            </Box>
                          ) : selectedDeploymentManifest.trim() ? (
                            <ResourceYamlPanel code={selectedDeploymentManifest} token={props.token} />
                          ) : releaseManifestErr ? (
                            <ErrorState message={`Release manifest unavailable: ${releaseManifestErr}`} />
                          ) : (
                            <EmptyState message="No release-backed manifest is available for the selected chart version." />
                          )}
                        </Box>
                      </Box>
                    </>
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
            <HelmReleaseDrawer
              open={!!releaseDrawer}
              onClose={() => setReleaseDrawer(null)}
              token={props.token}
              namespace={releaseDrawer?.namespace || ""}
              releaseName={releaseDrawer?.name || null}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}

function versionKey(version: HelmChartVersion) {
  return `${version.chartVersion || ""}\u0000${version.appVersion || ""}`;
}

function deploymentKey(deployment: HelmChartDeployment) {
  return `${deployment.namespace}\u0000${deployment.name}\u0000${deployment.revision || 0}`;
}
