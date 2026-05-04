import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { apiGetWithContext } from "../../../api";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import PodDrawer from "../pods/PodDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { nodeStatusChipColor, phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import { formatCPUMilli, formatMemoryBytes, formatPct, severityForPct } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import NodeActions from "./NodeActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import type {
  ApiItemResponse,
  NodeCapacity,
  NodeCondition,
  NodeDetails,
  NodeMetadata,
  NodePod,
  NodePodsSummary,
  NodeSummary,
  NodeTaint,
  DashboardSignalItem,
} from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

function isNodeConditionHealthy(cond: NodeCondition): boolean {
  if (cond.type === "Ready") return cond.status === "True";
  if (cond.status === "Unknown") return false;
  return cond.status === "False";
}

function nodeConditionChipColor(cond: NodeCondition): "success" | "warning" | "error" | "default" {
  if (cond.status === "Unknown") return "warning";
  return isNodeConditionHealthy(cond) ? "success" : "error";
}

function formatRoles(roles?: string[]) {
  if (!roles || roles.length === 0) return "-";
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      {roles.map((r) => (
        <Chip key={r} size="small" label={r} />
      ))}
    </Box>
  );
}

function nodeUsageTone(pct: number | undefined): GaugeTone {
  switch (severityForPct(pct, 70, 85)) {
    case "critical":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

function formatOsArch(summary?: NodeSummary) {
  const os = valueOrDash(summary?.osImage);
  const arch = valueOrDash(summary?.architecture);
  if (os === "-" && arch === "-") return "-";
  return `${os} / ${arch}`;
}

export default function NodeDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  nodeName: string | null;
}) {
  const activeContext = useActiveContext();
  const { health, retryNonce } = useConnectionState();
  const offline = health === "unhealthy";
  const metricsStatus = useMetricsStatus(props.token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<{ name: string; namespace: string } | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const name = props.nodeName;

  useEffect(() => {
    if (!props.open || !name || offline) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setDrawerPod(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGetWithContext<ApiItemResponse<NodeDetails>>(`/api/nodes/${encodeURIComponent(name)}`, props.token, activeContext);
      const item: NodeDetails | null = det?.item ?? null;
      setDetails(item);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, activeContext, retryNonce, offline]);

  const summary = details?.summary;
  const conditions = details?.conditions || [];
  const hasCapacityData =
    !!details?.capacity?.cpuCapacity ||
    !!details?.capacity?.cpuAllocatable ||
    !!details?.capacity?.memoryCapacity ||
    !!details?.capacity?.memoryAllocatable ||
    !!details?.capacity?.podsCapacity ||
    !!details?.capacity?.podsAllocatable;
  const taints = details?.taints || [];
  const derived = details?.derived;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "cluster",
    kind: "nodes",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Status",
        value: (
          <StatusChip size="small" label={valueOrDash(summary?.status)} color={nodeStatusChipColor(summary?.status)} />
        ),
      },
      { label: "Roles", value: formatRoles(summary?.roles) },
      { label: "Kubelet", value: valueOrDash(summary?.kubeletVersion) },
      { label: "OS / Architecture", value: formatOsArch(summary) },
      { label: "Kernel", value: valueOrDash(summary?.kernelVersion) },
      { label: "ProviderID", value: valueOrDash(summary?.providerID) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );
  const nodeSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="nodes" title={<>Node: {name || "-"}</>} onClose={props.onClose}>
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="Pods" />} iconPosition="start" label="Pods" />
              <Tab icon={<DetailTabIcon label="Conditions" />} iconPosition="start" label="Conditions" />
              <Tab icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  {derived ? (
                    <Section title="Derived Projection" divider={false}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                          <StatusChip size="small" color="warning" variant="outlined" label="Derived" />
                          <ScopedCountChip size="small" variant="outlined" label="Source" count={derived.source} />
                          {derived.coverage ? <ScopedCountChip size="small" variant="outlined" label="Coverage" count={derived.coverage} /> : null}
                          {derived.completeness ? <ScopedCountChip size="small" variant="outlined" label="Completeness" count={derived.completeness} /> : null}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {derived.note || "This node view is inferred from cached pod snapshots; direct node detail was not available."}
                        </Typography>
                      </Box>
                    </Section>
                  ) : null}

                  {name && !derived && (
                    <DrawerActionStrip>
                      <NodeActions
                        token={props.token}
                        nodeName={name}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={nodeSignals}
                    onJumpToConditions={() => setTab(2)}
                  />

                  <Section title="Capacity">
                    <Box sx={panelBoxSx}>
                      {hasCapacityData ? (
                        <>
                          <KeyValueTable
                            columns={2}
                            rows={[
                              {
                                label: "CPU capacity / allocatable",
                                value: `${valueOrDash(details?.capacity?.cpuCapacity)} / ${valueOrDash(
                                  details?.capacity?.cpuAllocatable
                                )}`,
                              },
                              {
                                label: "Memory capacity / allocatable",
                                value: `${valueOrDash(details?.capacity?.memoryCapacity)} / ${valueOrDash(
                                  details?.capacity?.memoryAllocatable
                                )}`,
                              },
                              {
                                label: "Pods capacity / allocatable",
                                value: `${valueOrDash(details?.capacity?.podsCapacity)} / ${valueOrDash(
                                  details?.capacity?.podsAllocatable
                                )}`,
                              },
                            ]}
                          />
                          {metricsUsable && details?.capacity?.usageAvailable ? (
                            <Box sx={{ mt: 1.5 }}>
                              <GaugeTableRow
                                label="CPU usage"
                                hint="Live CPU usage as percentage of allocatable; sourced from metrics.k8s.io."
                                bar={
                                  details.capacity.cpuPctAllocatable != null && details.capacity.cpuPctAllocatable > 0 ? (
                                    <GaugeBar
                                      value={details.capacity.cpuPctAllocatable}
                                      tone={nodeUsageTone(details.capacity.cpuPctAllocatable)}
                                    />
                                  ) : (
                                    <Box sx={{ fontSize: 12, color: "text.secondary" }}>No allocatable reported</Box>
                                  )
                                }
                                summary={`${formatPct(details.capacity.cpuPctAllocatable)} / ${formatCPUMilli(details.capacity.cpuMilliUsed)}`}
                              />
                              <GaugeTableRow
                                label="Memory usage"
                                hint="Live memory usage as percentage of allocatable; sourced from metrics.k8s.io."
                                bar={
                                  details.capacity.memoryPctAllocatable != null && details.capacity.memoryPctAllocatable > 0 ? (
                                    <GaugeBar
                                      value={details.capacity.memoryPctAllocatable}
                                      tone={nodeUsageTone(details.capacity.memoryPctAllocatable)}
                                    />
                                  ) : (
                                    <Box sx={{ fontSize: 12, color: "text.secondary" }}>No allocatable reported</Box>
                                  )
                                }
                                summary={`${formatPct(details.capacity.memoryPctAllocatable)} / ${formatMemoryBytes(details.capacity.memoryBytesUsed)}`}
                              />
                            </Box>
                          ) : null}
                        </>
                      ) : (
                        <EmptyState message="No capacity data reported for this node." />
                      )}
                    </Box>
                  </Section>

                  <Section title="Taints">
                    <Box sx={panelBoxSx}>
                      {taints.length === 0 ? (
                        <EmptyState message="No taints on this node." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Key</TableCell>
                              <TableCell>Value</TableCell>
                              <TableCell>Effect</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {taints.map((t, idx) => (
                              <TableRow key={`${t.key ?? "taint"}-${idx}`}>
                                <TableCell>{valueOrDash(t.key)}</TableCell>
                                <TableCell>{valueOrDash(t.value)}</TableCell>
                                <TableCell>{valueOrDash(t.effect)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Box>
                  </Section>

                </Box>
              )}

              {/* PODS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {(details?.pods || []).length === 0 ? (
                    <EmptyState message="No pods found for this node." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Pod</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Ready</TableCell>
                          <TableCell>Restarts</TableCell>
                          <TableCell>Age</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(details?.pods || []).map((p, idx) => (
                          <TableRow
                            key={p.namespace && p.name ? `${p.namespace}/${p.name}` : idx}
                            hover
                            onClick={() =>
                              p.name && p.namespace
                                ? setDrawerPod({ name: p.name, namespace: p.namespace })
                                : null
                            }
                            sx={{ cursor: p.name ? "pointer" : "default" }}
                          >
                            <TableCell>
                              {p.name && p.namespace ? (
                                <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                  <Typography
                                    component="button"
                                    type="button"
                                    variant="body2"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDrawerPod({ name: p.name, namespace: p.namespace });
                                    }}
                                    sx={{
                                      border: 0,
                                      p: 0,
                                      background: "transparent",
                                      color: "primary.main",
                                      cursor: "pointer",
                                      font: "inherit",
                                      fontWeight: 600,
                                      textAlign: "left",
                                    }}
                                  >
                                    {p.name}
                                  </Typography>
                                  <Typography
                                    component="button"
                                    type="button"
                                    variant="caption"
                                    color="text.secondary"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setDrawerNamespace(p.namespace);
                                    }}
                                    sx={{
                                      border: 0,
                                      p: 0,
                                      background: "transparent",
                                      cursor: "pointer",
                                      font: "inherit",
                                      textAlign: "left",
                                    }}
                                  >
                                    {p.namespace}
                                  </Typography>
                                </Box>
                              ) : (
                                valueOrDash(p.name)
                              )}
                            </TableCell>
                            <TableCell>
                              <Chip size="small" label={valueOrDash(p.phase)} color={phaseChipColor(p.phase)} />
                            </TableCell>
                            <TableCell>{valueOrDash(p.ready)}</TableCell>
                            <TableCell>{valueOrDash(p.restarts)}</TableCell>
                            <TableCell>{fmtAge(p.ageSec)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* CONDITIONS */}
              {tab === 2 && (
                <Box sx={drawerTabContentSx}>
                  <HealthConditionsPanel
                    conditions={conditions}
                    isHealthy={(cond) => isNodeConditionHealthy(cond as NodeCondition)}
                    chipColor={(cond) => nodeConditionChipColor(cond as NodeCondition)}
                    title="Node Conditions"
                  />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                  <MetadataSection labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Node",
                    group: "",
                    resource: "nodes",
                    apiVersion: "v1",
                    name: name || "",
                  }}
                />
              )}
            </Box>
            <PodDrawer
              open={!!drawerPod}
              onClose={() => setDrawerPod(null)}
              token={props.token}
              namespace={drawerPod?.namespace || ""}
              podName={drawerPod?.name || null}
            />
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
