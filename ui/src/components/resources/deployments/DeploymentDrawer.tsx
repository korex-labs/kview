import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
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
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import DeploymentActions from "./DeploymentActions";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import PodDrawer from "../pods/PodDrawer";
import ReplicaSetDrawer from "../replicasets/ReplicaSetDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import { fmtAge, fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import CodeBlock from "../../shared/CodeBlock";
import KeyValueChip from "../../shared/KeyValueChip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ContainerImageLabel from "../../shared/ContainerImageLabel";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import type {
  ApiItemResponse,
  ApiListResponse,
  DashboardSignalItem,
} from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type DeploymentDetails = {
  summary: DeploymentSummary;
  conditions: DeploymentCondition[];
  rollout: DeploymentRollout;
  replicaSets: DeploymentReplicaSet[];
  pods: DeploymentPod[];
  spec: DeploymentSpec;
  yaml: string;
};

type DeploymentDetailsResponse = ApiItemResponse<DeploymentDetails> & {
  detailSignals?: DashboardSignalItem[];
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
  missingReferences?: { kind: string; name: string; source?: string }[];
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
  const { health, retryNonce } = useConnectionState();
  const offline = health === "unhealthy";
  const [tab, setTab] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<DeploymentDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerReplicaSet, setDrawerReplicaSet] = useState<string | null>(null);
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
  const [drawerConfigMap, setDrawerConfigMap] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.deploymentName;

  // Load deployment details + events when opened
  useEffect(() => {
    if (!props.open || !name || offline) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDetailSignals([]);
    setDrawerPod(null);
    setDrawerReplicaSet(null);
    setDrawerSecret(null);
    setDrawerConfigMap(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<DeploymentDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name)}`,
        props.token
      );
      const item: DeploymentDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name)}/events?limit=5&type=Warning`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce, offline]);

  const summary = details?.summary;
  const rollout = details?.rollout;
  const rolloutNeedsAttention =
    !!rollout &&
    (rollout.progressDeadlineExceeded ||
      rollout.inProgress ||
      rollout.missingReplicas > 0 ||
      rollout.unavailableReplicas > 0 ||
      (rollout.warnings || []).length > 0);

  const snapshotSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "deployments",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce + refreshNonce,
  });

  const deploymentSignals = useMemo<DashboardSignalItem[]>(
    () => [...detailSignals, ...(snapshotSignals.signals || [])],
    [detailSignals, snapshotSignals.signals],
  );
  const missingRefSignalsByKey = useMemo(() => {
    const out = new Map<string, DashboardSignalItem>();
    deploymentSignals
      .filter((signal) => signal.signalType === "deployment_missing_template_reference")
      .forEach((signal) => {
        (signal.actualData || "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((ref) => out.set(ref.toLowerCase(), signal));
      });
    return out;
  }, [deploymentSignals]);

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

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
                <KeyValueChip key={part} chipKey={part.split("=")[0] || part} value={part.includes("=") ? part.slice(part.indexOf("=") + 1) : ""} />
              ))}
            </Box>
          );
        })(),
      },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            Deployment: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
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
              <Tab label="Metadata" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <DrawerActionStrip>
                      <DeploymentActions
                        token={props.token}
                        namespace={ns}
                        deploymentName={name}
                        currentReplicas={summary?.desired ?? 0}
                        onRefresh={() => setRefreshNonce((n) => n + 1)}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={deploymentSignals}
                    onJumpToEvents={() => setTab(3)}
                    onJumpToSpec={() => setTab(2)}
                  />

                  <HealthConditionsPanel
                    conditions={details?.conditions || []}
                    isHealthy={(cond) => isConditionHealthy(cond as DeploymentCondition)}
                  />

                  <Box sx={panelBoxSx}>
                    <Section
                      title="Rollout Summary"
                      dividerPlacement="content"
                      actions={
                        <>
                          {!!rollout && rollout.progressDeadlineExceeded && (
                            <Chip size="small" color="error" label="Deadline Exceeded" />
                          )}
                          {!!rollout && rollout.inProgress && !rollout.progressDeadlineExceeded && (
                            <Chip size="small" color="warning" label="In progress" />
                          )}
                        </>
                      }
                    >
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
                                : "Ok",
                          },
                          { label: "Last Rollout Start", value: rollout?.lastRolloutStart ? fmtTimeAgo(rollout.lastRolloutStart) : "-" },
                          {
                            label: "Last Rollout Complete",
                            value: rollout?.lastRolloutComplete ? fmtTimeAgo(rollout.lastRolloutComplete) : "-",
                          },
                        ]}
                      />
                    </Section>
                  </Box>

                  <Box sx={panelBoxSx}>
                    <Section
                      title="Rollout Diagnostics"
                      dividerPlacement="content"
                      actions={rolloutNeedsAttention ? <Chip size="small" color="warning" label="Attention" /> : null}
                    >
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
                    </Section>
                  </Box>

                  <Box sx={panelBoxSx}>
                    <Section title="Recent Warning events" dividerPlacement="content">
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Section>
                  </Box>
                </Box>
              )}

              {/* INVENTORY */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Box sx={panelBoxSx}>
                    <Section title="Pods" dividerPlacement="content">
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
                    </Section>
                  </Box>

                  <Box sx={panelBoxSx}>
                    <Section title="ReplicaSets" dividerPlacement="content">
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
                                  backgroundColor: rs.unhealthyPods ? "var(--chip-warning-bg)" : "transparent",
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
                    </Section>
                  </Box>
                </Box>
              )}

              {/* SPEC */}
              {tab === 2 && (
                <Box sx={drawerTabContentCompactSx}>
                  <Box sx={panelBoxSx}>
                    <Section title="Pod Template Summary" dividerPlacement="content">
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
                                  <ContainerImageLabel image={c.image} />
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
                                    <ContainerImageLabel image={c.image} />
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
                              .map((s) => {
                                const secretSignal = missingRefSignalsByKey.get(`secret/${s}`.toLowerCase());
                                return (
                                  <ResourceLinkChip
                                    key={s}
                                    label={s}
                                    onClick={() => setDrawerSecret(s)}
                                    color={secretSignal ? "warning" : undefined}
                                    title={secretSignal?.reason || secretSignal?.calculatedData || `Secret ${s}`}
                                  />
                                );
                              })}
                          </Box>
                        )}
                      </Box>
                    </Section>
                  </Box>

                  <Box sx={panelBoxSx}>
                    <Section title="Scheduling & Placement" dividerPlacement="content">
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
                              <KeyValueChip key={k} chipKey={k} value={v} />
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
                    </Section>
                  </Box>

                  <Box sx={panelBoxSx}>
                    <Section title="Volumes" dividerPlacement="content">
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
                                <TableCell>
                                  {String(v.type || "").toLowerCase() === "secret" && v.source ? (
                                    <ResourceLinkChip
                                      label={v.source}
                                      onClick={() => setDrawerSecret(v.source || null)}
                                      color={missingRefSignalsByKey.get(`secret/${v.source}`.toLowerCase()) ? "warning" : undefined}
                                      title={
                                        missingRefSignalsByKey.get(`secret/${v.source}`.toLowerCase())?.reason ||
                                        `Secret ${v.source}`
                                      }
                                    />
                                  ) : String(v.type || "").toLowerCase() === "configmap" && v.source ? (
                                    <ResourceLinkChip
                                      label={v.source}
                                      onClick={() => setDrawerConfigMap(v.source || null)}
                                      color={missingRefSignalsByKey.get(`configmap/${v.source}`.toLowerCase()) ? "warning" : undefined}
                                      title={
                                        missingRefSignalsByKey.get(`configmap/${v.source}`.toLowerCase())?.reason ||
                                        `ConfigMap ${v.source}`
                                      }
                                    />
                                  ) : (
                                    valueOrDash(v.source)
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Section>
                  </Box>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/deployments/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this Deployment." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 4 && (
                <Box sx={drawerTabContentCompactSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={summaryItems}
                      columns={3}
                      valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                    />
                  </Box>
                  <MetadataSection
                    labels={details?.spec?.metadata?.labels}
                    annotations={details?.spec?.metadata?.annotations}
                  />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Deployment",
                    group: "apps",
                    resource: "deployments",
                    apiVersion: "apps/v1",
                    namespace: ns,
                    name: name || "",
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
                />
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
            <SecretDrawer
              open={!!drawerSecret}
              onClose={() => setDrawerSecret(null)}
              token={props.token}
              namespace={ns}
              secretName={drawerSecret}
            />
            <ConfigMapDrawer
              open={!!drawerConfigMap}
              onClose={() => setDrawerConfigMap(null)}
              token={props.token}
              namespace={ns}
              configMapName={drawerConfigMap}
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
