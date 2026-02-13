import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Drawer,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
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
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGet } from "../api";
import { useConnectionState } from "../connectionState";
import DeploymentActions from "./DeploymentActions";
import Section from "./shared/Section";
import PodDrawer from "./PodDrawer";
import ReplicaSetDrawer from "./ReplicaSetDrawer";
import { fmtAge, fmtTs, valueOrDash } from "../utils/format";
import { phaseChipColor } from "../utils/k8sUi";
import KeyValueTable from "./shared/KeyValueTable";
import EmptyState from "./shared/EmptyState";
import ErrorState from "./shared/ErrorState";
import WarningsSection, { type Warning } from "./shared/WarningsSection";
import MetadataSection from "./shared/MetadataSection";
import ConditionsTable from "./shared/ConditionsTable";
import EventsList from "./shared/EventsList";
import CodeBlock from "./shared/CodeBlock";
import ResourceLinkChip from "./shared/ResourceLinkChip";
import NamespaceDrawer from "./NamespaceDrawer";

type DeploymentDetails = {
  summary: DeploymentSummary;
  conditions: DeploymentCondition[];
  rollout: DeploymentRollout;
  replicaSets: DeploymentReplicaSet[];
  pods: DeploymentPod[];
  spec: DeploymentSpec;
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

type DeploymentSummary = {
  name: string;
  namespace: string;
  strategy: string;
  selector: string;
  desired: number;
  current: number;
  ready: number;
  available: number;
  upToDate: number;
  ageSec: number;
};

type DeploymentCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type DeploymentRollout = {
  currentRevision?: string;
  observedGeneration: number;
  generation: number;
  progressDeadlineExceeded: boolean;
  lastRolloutStart?: number;
  lastRolloutComplete?: number;
  inProgress: boolean;
  warnings?: string[];
  missingReplicas: number;
  unavailableReplicas: number;
};

type DeploymentReplicaSet = {
  name: string;
  revision: number;
  desired: number;
  current: number;
  ready: number;
  ageSec: number;
  status: string;
  isActive: boolean;
  unhealthyPods: boolean;
};

type DeploymentPod = {
  name: string;
  phase: string;
  ready: string;
  restarts: number;
  node?: string;
  ageSec: number;
};

type DeploymentSpec = {
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

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

function isConditionHealthy(cond: DeploymentCondition) {
  if (cond.type === "ReplicaFailure") {
    return cond.status !== "True";
  }
  return cond.status === "True";
}

export default function DeploymentDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  deploymentName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<DeploymentDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerReplicaSet, setDrawerReplicaSet] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.deploymentName;

  // Load deployment details + events when opened
  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPod(null);
    setDrawerReplicaSet(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name)}`,
        props.token
      );
      const item: DeploymentDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const hasUnhealthyConditions = (details?.conditions || []).some((c) => !isConditionHealthy(c));
  const rollout = details?.rollout;
  const rolloutNeedsAttention =
    !!rollout &&
    (rollout.progressDeadlineExceeded ||
      rollout.inProgress ||
      rollout.missingReplicas > 0 ||
      rollout.unavailableReplicas > 0 ||
      (rollout.warnings || []).length > 0);

  // Threshold for "unavailable for extended time" warning (10 minutes = 600 seconds)
  const UNAVAILABLE_THRESHOLD_SEC = 600;

  const deploymentWarnings = useMemo((): Warning[] => {
    const warnings: Warning[] = [];
    if (!summary || !details) return warnings;

    // Check if deployment is unavailable for extended time
    const desired = summary.desired ?? 0;
    const available = summary.available ?? 0;
    const conditions = details.conditions || [];

    if (desired > 0 && available === 0) {
      // Find the "Available" condition
      const availableCond = conditions.find((c) => c.type === "Available");
      if (availableCond && availableCond.status === "False" && availableCond.lastTransitionTime) {
        const nowSec = Math.floor(Date.now() / 1000);
        const transitionAgeSec = nowSec - availableCond.lastTransitionTime;
        if (transitionAgeSec > UNAVAILABLE_THRESHOLD_SEC) {
          const mins = Math.floor(transitionAgeSec / 60);
          warnings.push({
            message: `Deployment has been unavailable for ${mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}.`,
            detail: availableCond.reason
              ? `Reason: ${availableCond.reason}${availableCond.message ? ` - ${availableCond.message}` : ""}`
              : undefined,
          });
        }
      } else if (!availableCond) {
        // Fallback: if no Available condition but desired > 0, ready == 0, and age > threshold
        const ageSec = summary.ageSec ?? 0;
        if (ageSec > UNAVAILABLE_THRESHOLD_SEC) {
          const mins = Math.floor(ageSec / 60);
          warnings.push({
            message: `Deployment has had no available replicas for ${mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`} (best-effort detection).`,
          });
        }
      }
    }

    return warnings;
  }, [summary, details]);

  const summaryItems = useMemo(
    () => [
      { label: "Desired replicas", value: valueOrDash(summary?.desired) },
      { label: "Updated replicas", value: valueOrDash(summary?.upToDate) },
      { label: "Ready replicas", value: valueOrDash(summary?.ready) },
      { label: "Available replicas", value: valueOrDash(summary?.available) },
      { label: "Strategy", value: valueOrDash(summary?.strategy) },
      {
        label: "Namespace",
        value: summary?.namespace ? (
          <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} />
        ) : (
          "-"
        ),
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      {
        label: "Selector",
        value: (() => {
          if (!summary?.selector) return "-";
          const parts = summary.selector.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 0) return "-";
          return (
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {parts.map((part) => (
                <Chip key={part} size="small" label={part} />
              ))}
            </Box>
          );
        })(),
      },
    ],
    [summary]
  );

  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      PaperProps={{
        sx: {
          mt: 8,
          height: "calc(100% - 64px)",
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
        },
      }}
    >
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Deployment: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
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
              <Tab label="Rollout" />
              <Tab label="Pods" />
              <Tab label="Spec" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <DeploymentActions
                        token={props.token}
                        namespace={ns}
                        deploymentName={name}
                        currentReplicas={summary?.desired ?? 0}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <WarningsSection warnings={deploymentWarnings} />

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>

                  <ConditionsTable
                    conditions={details?.conditions || []}
                    isHealthy={isConditionHealthy}
                  />

                  <Accordion defaultExpanded={!!rollout && (rollout.inProgress || rollout.progressDeadlineExceeded)}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Rollout Summary</Typography>
                      {!!rollout && rollout.progressDeadlineExceeded && (
                        <Chip size="small" color="error" label="Deadline Exceeded" sx={{ ml: 1 }} />
                      )}
                      {!!rollout && rollout.inProgress && !rollout.progressDeadlineExceeded && (
                        <Chip size="small" color="warning" label="In progress" sx={{ ml: 1 }} />
                      )}
                    </AccordionSummary>
                    <AccordionDetails>
                      <KeyValueTable
                        columns={2}
                        rows={[
                          { label: "Current Revision", value: rollout?.currentRevision },
                          {
                            label: "Observed / Spec Generation",
                            value: `${valueOrDash(rollout?.observedGeneration)} / ${valueOrDash(rollout?.generation)}`,
                          },
                          {
                            label: "Progress Deadline",
                            value:
                              rollout?.progressDeadlineExceeded === undefined
                                ? "-"
                                : rollout.progressDeadlineExceeded
                                ? "Exceeded"
                                : "OK",
                          },
                          { label: "Last Rollout Start", value: rollout?.lastRolloutStart ? fmtTs(rollout.lastRolloutStart) : "-" },
                          {
                            label: "Last Rollout Complete",
                            value: rollout?.lastRolloutComplete ? fmtTs(rollout.lastRolloutComplete) : "-",
                          },
                        ]}
                      />
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* ROLLOUT */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">ReplicaSets</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.replicaSets || []).length === 0 ? (
                        <EmptyState message="No ReplicaSets found for this Deployment." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Revision</TableCell>
                              <TableCell>Name</TableCell>
                              <TableCell>Desired</TableCell>
                              <TableCell>Current</TableCell>
                              <TableCell>Ready</TableCell>
                              <TableCell>Age</TableCell>
                              <TableCell>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.replicaSets || []).map((rs, idx) => (
                              <TableRow
                                key={rs.name || String(idx)}
                                hover
                                onClick={() => rs.name && setDrawerReplicaSet(rs.name)}
                                sx={{
                                  backgroundColor: rs.unhealthyPods ? "rgba(255, 152, 0, 0.12)" : "transparent",
                                  cursor: rs.name ? "pointer" : "default",
                                }}
                              >
                                <TableCell>{rs.revision}</TableCell>
                                <TableCell>{valueOrDash(rs.name)}</TableCell>
                                <TableCell>{valueOrDash(rs.desired)}</TableCell>
                                <TableCell>{valueOrDash(rs.current)}</TableCell>
                                <TableCell>{valueOrDash(rs.ready)}</TableCell>
                                <TableCell>{fmtAge(rs.ageSec)}</TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                                    <Chip
                                      size="small"
                                      label={valueOrDash(rs.status)}
                                      color={rs.status === "Active" ? "success" : "default"}
                                    />
                                    {rs.isActive && <Chip size="small" label="Current" color="primary" />}
                                    {rs.unhealthyPods && <Chip size="small" label="Unhealthy Pods" color="warning" />}
                                  </Box>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion defaultExpanded={rolloutNeedsAttention}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Rollout Diagnostics</Typography>
                      {rolloutNeedsAttention && <Chip size="small" color="warning" label="Attention" sx={{ ml: 1 }} />}
                    </AccordionSummary>
                    <AccordionDetails>
                      {!rollout ? (
                        <EmptyState message="No rollout diagnostics available." />
                      ) : (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                            {rollout.progressDeadlineExceeded && (
                              <Chip size="small" color="error" label="ProgressDeadlineExceeded" />
                            )}
                            {rollout.missingReplicas > 0 && (
                              <Chip size="small" color="warning" label={`Missing replicas: ${rollout.missingReplicas}`} />
                            )}
                            {rollout.unavailableReplicas > 0 && (
                              <Chip
                                size="small"
                                color="warning"
                                label={`Unavailable replicas: ${rollout.unavailableReplicas}`}
                              />
                            )}
                            {rollout.inProgress && <Chip size="small" color="info" label="Rollout in progress" />}
                          </Box>
                          {(rollout.warnings || []).length === 0 ? (
                            <EmptyState message="No warnings reported." />
                          ) : (
                            (rollout.warnings || []).map((w, idx) => (
                              <Typography key={`${w}-${idx}`} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                                {w}
                              </Typography>
                            ))
                          )}
                        </Box>
                      )}
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* PODS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {(details?.pods || []).length === 0 ? (
                    <EmptyState message="No pods found for this Deployment." />
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
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
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
                      <Typography variant="subtitle2">Metadata</Typography>
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
              {tab === 4 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this Deployment." />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
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
            <ReplicaSetDrawer
              open={!!drawerReplicaSet}
              onClose={() => setDrawerReplicaSet(null)}
              token={props.token}
              namespace={ns}
              replicaSetName={drawerReplicaSet}
            />
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={props.token}
              namespaceName={drawerNamespace}
            />
          </>
        )}
      </Box>
    </Drawer>
  );
}
