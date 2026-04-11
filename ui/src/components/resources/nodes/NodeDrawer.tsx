import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGetWithContext } from "../../../api";
import { useActiveContext } from "../../../activeContext";
import { useConnectionState } from "../../../connectionState";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import CodeBlock from "../../shared/CodeBlock";
import PodDrawer from "../pods/PodDrawer";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { nodeStatusChipColor, phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import NodeActions from "./NodeActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import type { ApiItemResponse } from "../../../types/api";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type NodeDetails = {
  summary: NodeSummary;
  metadata: NodeMetadata;
  conditions: NodeCondition[];
  capacity: NodeCapacity;
  taints: NodeTaint[];
  pods: NodePod[];
  linkedPods: NodePodsSummary;
  yaml: string;
  derived?: {
    source: string;
    coverage?: string;
    completeness?: string;
    note?: string;
  };
};

type NodeSummary = {
  name: string;
  status: string;
  roles?: string[];
  kubeletVersion?: string;
  osImage?: string;
  kernelVersion?: string;
  architecture?: string;
  providerID?: string;
  createdAt: number;
  ageSec: number;
};

type NodeMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type NodeCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type NodeCapacity = {
  cpuCapacity?: string;
  cpuAllocatable?: string;
  memoryCapacity?: string;
  memoryAllocatable?: string;
  podsCapacity?: string;
  podsAllocatable?: string;
};

type NodeTaint = {
  key?: string;
  value?: string;
  effect?: string;
};

type NodePodsSummary = {
  total: number;
};

type NodePod = {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  ageSec: number;
};

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
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<{ name: string; namespace: string } | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const name = props.nodeName;

  useEffect(() => {
    if (!props.open || !name) return;

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
  }, [props.open, name, props.token, activeContext, retryNonce]);

  const summary = details?.summary;
  const conditions = details?.conditions || [];
  const hasUnhealthyConditions = conditions.some((c) => !isNodeConditionHealthy(c));
  const hasCapacityData =
    !!details?.capacity?.cpuCapacity ||
    !!details?.capacity?.cpuAllocatable ||
    !!details?.capacity?.memoryCapacity ||
    !!details?.capacity?.memoryAllocatable ||
    !!details?.capacity?.podsCapacity ||
    !!details?.capacity?.podsAllocatable;
  const taints = details?.taints || [];
  const derived = details?.derived;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Status",
        value: (
          <Chip size="small" label={valueOrDash(summary?.status)} color={nodeStatusChipColor(summary?.status)} />
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

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell title={<>Node: {name || "-"}</>} onClose={props.onClose}>
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Pods" />
              <Tab label="Conditions" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  {derived ? (
                    <Section title="Derived Projection" divider={false}>
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                          <Chip size="small" color="warning" variant="outlined" label="Derived" />
                          <Chip size="small" variant="outlined" label={`Source ${derived.source}`} />
                          {derived.coverage ? <Chip size="small" variant="outlined" label={`Coverage ${derived.coverage}`} /> : null}
                          {derived.completeness ? <Chip size="small" variant="outlined" label={`Completeness ${derived.completeness}`} /> : null}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {derived.note || "This node view is inferred from cached pod snapshots; direct node detail was not available."}
                        </Typography>
                      </Box>
                    </Section>
                  ) : null}

                  {name && !derived && (
                    <Section title="Actions" divider={false}>
                      <NodeActions
                        token={props.token}
                        nodeName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <Accordion defaultExpanded={hasCapacityData}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Capacity</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
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
                    </AccordionDetails>
                  </Accordion>

                  <Accordion defaultExpanded={taints.length > 0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Taints</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
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
                    </AccordionDetails>
                  </Accordion>

                  <MetadataSection labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} />
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
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <ConditionsTable
                    conditions={conditions}
                    isHealthy={(cond) => isNodeConditionHealthy(cond as NodeCondition)}
                    chipColor={(cond) => nodeConditionChipColor(cond as NodeCondition)}
                    title="Node Conditions"
                  />
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
