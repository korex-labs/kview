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
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import PodDrawer from "../pods/PodDrawer";
import DaemonSetActions from "./DaemonSetActions";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import Section from "../../shared/Section";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import EventsList from "../../shared/EventsList";
import CodeBlock from "../../shared/CodeBlock";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse, ApiListResponse } from "../../../types/api";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type DaemonSetDetails = {
  summary: DaemonSetSummary;
  conditions: DaemonSetCondition[];
  pods: DaemonSetPod[];
  spec: DaemonSetSpec;
  metadata: DaemonSetMetadata;
  yaml: string;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

type DaemonSetSummary = {
  name: string;
  namespace: string;
  updateStrategy?: string;
  maxUnavailable?: string;
  maxSurge?: string;
  selector?: string;
  desired: number;
  current: number;
  ready: number;
  updated: number;
  available: number;
  ageSec: number;
};

type DaemonSetCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type DaemonSetPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type DaemonSetSpec = {
  podTemplate: {
    containers?: ContainerSummary[];
    initContainers?: ContainerSummary[];
    imagePullSecrets?: string[];
  };
  scheduling: {
    nodeSelector?: Record<string, string>;
    affinitySummary?: string;
    tolerations?: {
      key?: string;
      operator?: string;
      value?: string;
      effect?: string;
      seconds?: number;
    }[];
    topologySpreadConstraints?: {
      maxSkew: number;
      topologyKey?: string;
      whenUnsatisfiable?: string;
      labelSelector?: string;
    }[];
  };
  volumes?: { name: string; type?: string; source?: string }[];
  metadata: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
};

type DaemonSetMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

function isConditionHealthy(cond: DaemonSetCondition) {
  return cond.status === "True";
}

export default function DaemonSetDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  daemonSetName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<DaemonSetDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.daemonSetName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPod(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<DaemonSetDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/daemonsets/${encodeURIComponent(name)}`,
        props.token
      );
      const item: DaemonSetDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/daemonsets/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name) },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Desired", value: valueOrDash(summary?.desired) },
      { label: "Current", value: valueOrDash(summary?.current) },
      { label: "Ready", value: valueOrDash(summary?.ready) },
      { label: "Updated", value: valueOrDash(summary?.updated) },
      { label: "Available", value: valueOrDash(summary?.available) },
      { label: "Update strategy", value: valueOrDash(summary?.updateStrategy) },
      { label: "Max unavailable", value: valueOrDash(summary?.maxUnavailable) },
      { label: "Max surge", value: valueOrDash(summary?.maxSurge) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Selector", value: valueOrDash(summary?.selector) },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            DaemonSet: {name || "-"}{" "}
            <Typography component="span" variant="body2">
              ({ns})
            </Typography>
          </>
        }
        onClose={props.onClose}
      >
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
              <Tab label="Spec" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <DaemonSetActions
                        token={props.token}
                        namespace={ns}
                        daemonSetName={name}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>

                  <ConditionsTable conditions={details?.conditions || []} isHealthy={(cond) => isConditionHealthy(cond as DaemonSetCondition)} />

                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />
                </Box>
              )}

              {/* PODS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {(details?.pods || []).length === 0 ? (
                    <EmptyState message="No pods found for this DaemonSet." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Pod</TableCell>
                          <TableCell>Phase</TableCell>
                          <TableCell>Ready</TableCell>
                          <TableCell>Restarts</TableCell>
                          <TableCell>Node</TableCell>
                          <TableCell>Age</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(details?.pods || []).map((p, idx) => (
                          <TableRow
                            key={p.name || String(idx)}
                            hover
                            onClick={() => p.name && setDrawerPod(p.name)}
                            sx={{ cursor: p.name ? "pointer" : "default" }}
                          >
                            <TableCell>{valueOrDash(p.name)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={valueOrDash(p.phase)} color={phaseChipColor(p.phase)} />
                            </TableCell>
                            <TableCell>{valueOrDash(p.ready)}</TableCell>
                            <TableCell>{valueOrDash(p.restarts)}</TableCell>
                            <TableCell>{valueOrDash(p.node)}</TableCell>
                            <TableCell>{fmtAge(p.ageSec)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* SPEC */}
              {tab === 2 && (
                <Box sx={drawerTabContentCompactSx}>
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Pod Template Summary</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography variant="caption" color="text.secondary">
                        Containers
                      </Typography>
                      {(details?.spec?.podTemplate?.containers || []).length === 0 ? (
                        <EmptyState message="No containers defined." sx={{ mt: 0.5 }} />
                      ) : (
                        <Table size="small" sx={{ mt: 0.5 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Image</TableCell>
                              <TableCell>CPU Req/Lim</TableCell>
                              <TableCell>Memory Req/Lim</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.spec?.podTemplate?.containers || []).map((c, idx) => (
                              <TableRow key={c.name || String(idx)}>
                                <TableCell>{valueOrDash(c.name)}</TableCell>
                                <TableCell sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                                  {valueOrDash(c.image)}
                                </TableCell>
                                <TableCell>
                                  {valueOrDash(c.cpuRequest)} / {valueOrDash(c.cpuLimit)}
                                </TableCell>
                                <TableCell>
                                  {valueOrDash(c.memoryRequest)} / {valueOrDash(c.memoryLimit)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Init Containers
                        </Typography>
                        {(details?.spec?.podTemplate?.initContainers || []).length === 0 ? (
                          <EmptyState message="No init containers." sx={{ mt: 0.5 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Image</TableCell>
                                <TableCell>CPU Req/Lim</TableCell>
                                <TableCell>Memory Req/Lim</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(details?.spec?.podTemplate?.initContainers || []).map((c, idx) => (
                                <TableRow key={c.name || String(idx)}>
                                  <TableCell>{valueOrDash(c.name)}</TableCell>
                                  <TableCell sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                                    {valueOrDash(c.image)}
                                  </TableCell>
                                  <TableCell>
                                    {valueOrDash(c.cpuRequest)} / {valueOrDash(c.cpuLimit)}
                                  </TableCell>
                                  <TableCell>
                                    {valueOrDash(c.memoryRequest)} / {valueOrDash(c.memoryLimit)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Image Pull Secrets
                        </Typography>
                        {(details?.spec?.podTemplate?.imagePullSecrets || []).length === 0 ? (
                          <EmptyState message="No image pull secrets." sx={{ mt: 0.5 }} />
                        ) : (
                          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                            {(details?.spec?.podTemplate?.imagePullSecrets || [])
                              .filter((s): s is string => !!s)
                              .map((s) => (
                                <Chip key={s} size="small" label={s} />
                              ))}
                          </Box>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Scheduling & Placement</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <KeyValueTable
                        columns={2}
                        rows={[{ label: "Affinity", value: details?.spec?.scheduling?.affinitySummary }]}
                      />

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Node Selectors
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                          {Object.entries(details?.spec?.scheduling?.nodeSelector || {}).length === 0 ? (
                            <EmptyState message="None" />
                          ) : (
                            Object.entries(details?.spec?.scheduling?.nodeSelector || {}).map(([k, v]) => (
                              <Chip key={k} size="small" label={`${k}=${v}`} />
                            ))
                          )}
                        </Box>
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Tolerations
                        </Typography>
                        {(details?.spec?.scheduling?.tolerations || []).length === 0 ? (
                          <EmptyState message="None" sx={{ mt: 0.5 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Key</TableCell>
                                <TableCell>Operator</TableCell>
                                <TableCell>Value</TableCell>
                                <TableCell>Effect</TableCell>
                                <TableCell>Seconds</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(details?.spec?.scheduling?.tolerations || []).map((t, idx) => (
                                <TableRow key={`${t.key ?? "toleration"}-${idx}`}>
                                  <TableCell>{valueOrDash(t.key)}</TableCell>
                                  <TableCell>{valueOrDash(t.operator)}</TableCell>
                                  <TableCell>{valueOrDash(t.value)}</TableCell>
                                  <TableCell>{valueOrDash(t.effect)}</TableCell>
                                  <TableCell>{t.seconds !== undefined ? t.seconds : "-"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Topology Spread Constraints
                        </Typography>
                        {(details?.spec?.scheduling?.topologySpreadConstraints || []).length === 0 ? (
                          <EmptyState message="None" sx={{ mt: 0.5 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Topology Key</TableCell>
                                <TableCell>Max Skew</TableCell>
                                <TableCell>When Unsatisfiable</TableCell>
                                <TableCell>Label Selector</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(details?.spec?.scheduling?.topologySpreadConstraints || []).map((t, idx) => (
                                <TableRow key={`${t.topologyKey ?? "topology"}-${idx}`}>
                                  <TableCell>{valueOrDash(t.topologyKey)}</TableCell>
                                  <TableCell>{valueOrDash(t.maxSkew)}</TableCell>
                                  <TableCell>{valueOrDash(t.whenUnsatisfiable)}</TableCell>
                                  <TableCell>{valueOrDash(t.labelSelector)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Volumes</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.spec?.volumes || []).length === 0 ? (
                        <EmptyState message="No volumes defined." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Type</TableCell>
                              <TableCell>Source</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.spec?.volumes || []).map((v, idx) => (
                              <TableRow key={v.name || String(idx)}>
                                <TableCell>{valueOrDash(v.name)}</TableCell>
                                <TableCell>{valueOrDash(v.type)}</TableCell>
                                <TableCell>{valueOrDash(v.source)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Template Metadata</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <MetadataSection
                        labels={details?.spec?.metadata?.labels}
                        annotations={details?.spec?.metadata?.annotations}
                        wrapInSection={false}
                      />
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this DaemonSet." />
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
            <PodDrawer
              open={!!drawerPod}
              onClose={() => setDrawerPod(null)}
              token={props.token}
              namespace={ns}
              podName={drawerPod}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
