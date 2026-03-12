import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  FormControlLabel,
  Switch,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGet, toApiError, type ApiError } from "../api";
import { useConnectionState } from "../connectionState";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { fmtAge, fmtTs, valueOrDash } from "../utils/format";
import { eventChipColor, phaseChipColor } from "../utils/k8sUi";
import ConditionsTable from "./shared/ConditionsTable";
import CodeBlock from "./shared/CodeBlock";
import IngressDrawer from "./IngressDrawer";
import ServiceDrawer from "./ServiceDrawer";
import DeploymentDrawer from "./DeploymentDrawer";
import ReplicaSetDrawer from "./ReplicaSetDrawer";
import StatefulSetDrawer from "./StatefulSetDrawer";
import DaemonSetDrawer from "./DaemonSetDrawer";
import JobDrawer from "./JobDrawer";
import NodeDrawer from "./NodeDrawer";
import PodActions from "./PodActions";
import RightDrawer from "./layout/RightDrawer";
import ServiceAccountDrawer from "./ServiceAccountDrawer";
import NamespaceDrawer from "./NamespaceDrawer";
import Section from "./shared/Section";
import KeyValueTable from "./shared/KeyValueTable";
import AccessDeniedState from "./shared/AccessDeniedState";
import EmptyState from "./shared/EmptyState";
import ErrorState from "./shared/ErrorState";
import ResourceLinkChip from "./shared/ResourceLinkChip";
import WarningsSection, { type Warning } from "./shared/WarningsSection";

type PodDetails = {
  summary: PodSummary;
  conditions: PodCondition[];
  lifecycle: PodLifecycle;
  containers: PodContainer[];
  resources: PodResources;
  yaml: string;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  fieldPath?: string;
};

type PodSummary = {
  name: string;
  namespace: string;
  node?: string;
  phase: string;
  ready: string;
  restarts: number;
  maxRestarts: number;
  podIP?: string;
  hostIP?: string;
  qosClass?: string;
  startTime?: number;
  ageSec?: number;
  controllerKind?: string;
  controllerName?: string;
  serviceAccount?: string;
};

type PodCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type PodLifecycle = {
  restartPolicy?: string;
  priorityClass?: string;
  preemptionPolicy?: string;
  nodeSelector?: Record<string, string>;
  affinitySummary?: string;
  tolerations?: {
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    seconds?: number;
  }[];
};

type PodContainer = {
  name: string;
  image?: string;
  imageId?: string;
  ready: boolean;
  state?: string;
  reason?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
  restartCount: number;
  lastTerminationReason?: string;
  lastTerminationMessage?: string;
  lastTerminationAt?: number;
  resources: {
    cpuRequest?: string;
    cpuLimit?: string;
    memoryRequest?: string;
    memoryLimit?: string;
  };
  env: {
    name: string;
    value?: string;
    source?: string;
    sourceRef?: string;
    optional?: boolean;
  }[];
  mounts: {
    name: string;
    mountPath: string;
    readOnly: boolean;
    subPath?: string;
  }[];
  probes: {
    liveness?: Probe;
    readiness?: Probe;
    startup?: Probe;
  };
  securityContext: ContainerSecurity;
};

type Probe = {
  type?: string;
  command?: string;
  path?: string;
  port?: string;
  scheme?: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
};

type ContainerSecurity = {
  name: string;
  runAsUser?: number;
  runAsGroup?: number;
  privileged?: boolean;
  readOnlyRootFilesystem?: boolean;
  allowPrivilegeEscalation?: boolean;
  capabilitiesAdd?: string[];
  capabilitiesDrop?: string[];
  seccompProfile?: string;
};

type PodResources = {
  volumes?: { name: string; type?: string; source?: string }[];
  imagePullSecrets?: string[];
  podSecurityContext: {
    runAsUser?: number;
    runAsGroup?: number;
    fsGroup?: number;
    fsGroupChangePolicy?: string;
    seccompProfile?: string;
    supplementalGroups?: number[];
    sysctls?: { name: string; value: string }[];
  };
  containerSecurityContexts?: ContainerSecurity[];
  dnsPolicy?: string;
  hostAliases?: { ip: string; hostnames: string[] }[];
  topologySpreadConstraints?: {
    maxSkew: number;
    topologyKey?: string;
    whenUnsatisfiable?: string;
    labelSelector?: string;
  }[];
};

type PodNetworkingService = {
  name: string;
  namespace: string;
  type: string;
  selector?: Record<string, string>;
  portsSummary?: string;
  endpointsReady: number;
  endpointsNotReady: number;
};

type PodNetworkingIngress = {
  name: string;
  namespace: string;
  ingressClassName?: string;
  hosts?: string[];
  tlsCount?: number;
  addresses?: string[];
};

function wsURL(path: string, token: string) {
  const u = new URL(window.location.href);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  const sep = path.includes("?") ? "&" : "?";
  return `${proto}//${u.host}${path}${sep}token=${encodeURIComponent(token)}`;
}

function tryPrettyJSONLine(line: string): string | null {
  const s = line.trim();
  if (!s) return null;
  try {
    const obj = JSON.parse(s);
    return JSON.stringify(obj, null, 2);
  } catch {
    return null;
  }
}

function isConditionHealthy(cond: PodCondition) {
  return cond.status === "True";
}

function isContainerHealthy(ctn: PodContainer) {
  if (!ctn.ready) return false;
  if (!ctn.state) return false;
  return ctn.state === "Running";
}

function containerStateColor(state?: string): "success" | "warning" | "error" | "default" {
  if (!state) return "default";
  if (state === "Running") return "success";
  if (state === "Waiting") return "warning";
  if (state === "Terminated") return "error";
  return "default";
}

function parseContainerFromFieldPath(path?: string) {
  if (!path) return "";
  const match = path.match(/spec\.(?:initContainers|containers|ephemeralContainers)\{(.+)\}/);
  return match ? match[1] : "";
}

function formatProbeDetails(probe?: Probe) {
  if (!probe) return "-";
  const base = `${probe.type || "Probe"}`;
  const port = probe.port ? `:${probe.port}` : "";
  const path = probe.path ? `${probe.path}` : "";
  const scheme = probe.scheme ? `${probe.scheme} ` : "";
  const target = probe.command ? probe.command : `${scheme}${path}${port}`;
  return [base, target].filter(Boolean).join(" ");
}

function formatIngressHostsSummary(hosts?: string[]) {
  if (!hosts || hosts.length === 0) return "-";
  const short = hosts.slice(0, 3).join(", ");
  if (hosts.length <= 3) return `${hosts.length} (${short})`;
  return `${hosts.length} (${short}, +${hosts.length - 3} more)`;
}

function formatIngressAddresses(addrs?: string[]) {
  if (!addrs || addrs.length === 0) return "-";
  return addrs.join(", ");
}

function formatIngressTlsLabel(count?: number) {
  const num = Number(count || 0);
  return num > 0 ? `Yes (${num})` : "No";
}

function formatPretty(lines: string[]): string {
  const out: string[] = [];
  lines.forEach((line) => {
    const prettyStr = tryPrettyJSONLine(line);
    if (prettyStr) {
      out.push(prettyStr);
    } else {
      out.push(line);
    }
  });
  return out.join("\n");
}

export default function PodDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  podName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<PodDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [expandedContainers, setExpandedContainers] = useState<Record<string, boolean>>({});
  const [envQueryByContainer, setEnvQueryByContainer] = useState<Record<string, string>>({});
  const [envShowRawByContainer, setEnvShowRawByContainer] = useState<Record<string, boolean>>({});
  const [eventsContainerFilter, setEventsContainerFilter] = useState<string>("");
  const [networkingServices, setNetworkingServices] = useState<PodNetworkingService[]>([]);
  const [networkingServicesLoading, setNetworkingServicesLoading] = useState(false);
  const [networkingServicesLoaded, setNetworkingServicesLoaded] = useState(false);
  const [networkingServicesErr, setNetworkingServicesErr] = useState<ApiError | null>(null);
  const [networkingIngresses, setNetworkingIngresses] = useState<PodNetworkingIngress[]>([]);
  const [networkingIngressesLoading, setNetworkingIngressesLoading] = useState(false);
  const [networkingIngressesLoaded, setNetworkingIngressesLoaded] = useState(false);
  const [networkingIngressesErr, setNetworkingIngressesErr] = useState<ApiError | null>(null);
  const [drawerService, setDrawerService] = useState<string | null>(null);
  const [drawerIngress, setDrawerIngress] = useState<{ name: string; namespace: string } | null>(null);
  const [drawerReplicaSet, setDrawerReplicaSet] = useState<string | null>(null);
  const [drawerDeployment, setDrawerDeployment] = useState<string | null>(null);
  const [drawerStatefulSet, setDrawerStatefulSet] = useState<string | null>(null);
  const [drawerDaemonSet, setDrawerDaemonSet] = useState<string | null>(null);
  const [drawerJob, setDrawerJob] = useState<string | null>(null);
  const [drawerNode, setDrawerNode] = useState<string | null>(null);
  const [drawerServiceAccount, setDrawerServiceAccount] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  // Logs UI state
  const [container, setContainer] = useState<string>("");
  const [logsFilter, setLogsFilter] = useState<string>("");
  const [pretty, setPretty] = useState<boolean>(false);
  const [following, setFollowing] = useState<boolean>(false);
  const [lineLimit, setLineLimit] = useState<number>(500);
  const [wrapLines, setWrapLines] = useState<boolean>(false);

  // Store log entries as array for filtering + pretty formatting
  const [logLines, setLogLines] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const ns = props.namespace;
  const name = props.podName;

  const logWsBase = useMemo(() => {
    if (!name) return "";
    return `/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/logs/ws`;
  }, [name, ns]);

  function stopLogs() {
    setFollowing(false);
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }

  function startLogsFollow() {
    if (!name) return;

    stopLogs();
    setLogLines([]);

    const qs = new URLSearchParams();
    if (container) qs.set("container", container);
    qs.set("follow", "1");
    if (lineLimit > 0) {
      qs.set("tail", String(Math.min(lineLimit, 5000)));
    }

    const ws = new WebSocket(wsURL(`${logWsBase}?${qs.toString()}`, props.token));
    wsRef.current = ws;
    setFollowing(true);

    ws.onmessage = (ev) => {
      const chunk = String(ev.data ?? "");
      // logs stream usually already ends with \n, but keep safe
      const parts = chunk.split("\n");
      setLogLines((prev) => {
        const next = [...prev];
        for (const p of parts) {
          if (p.length) next.push(p);
        }
        // avoid unbounded growth in MVP
        if (next.length > 5000) return next.slice(next.length - 5000);
        return next;
      });
    };

    ws.onerror = () => {
      setLogLines((prev) => [...prev, "[WS ERROR]"]);
      setFollowing(false);
    };

    ws.onclose = () => {
      setFollowing(false);
    };
  }

  // Cleanup on close / pod switch
  useEffect(() => {
    if (!props.open) {
      stopLogs();
      return;
    }
    return () => stopLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, name]);

  // Load pod details + events when opened
  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setLogLines([]);
    setLogsFilter("");
    setPretty(false);
    setWrapLines(false);
    setExpandedContainers({});
    setEnvQueryByContainer({});
    setEnvShowRawByContainer({});
    setEventsContainerFilter("");
    setNetworkingServices([]);
    setNetworkingServicesLoading(false);
    setNetworkingServicesLoaded(false);
    setNetworkingServicesErr(null);
    setNetworkingIngresses([]);
    setNetworkingIngressesLoading(false);
    setNetworkingIngressesLoaded(false);
    setNetworkingIngressesErr(null);
    setDrawerService(null);
    setDrawerIngress(null);
    setDrawerReplicaSet(null);
    setDrawerDeployment(null);
    setDrawerStatefulSet(null);
    setDrawerDaemonSet(null);
    setDrawerJob(null);
    setDrawerNode(null);
    setDrawerServiceAccount(null);
    setDrawerNamespace(null);
    stopLogs();

    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`,
        props.token
      );
      const item: PodDetails | null = det?.item ?? null;
      setDetails(item);

      // default container
      const containers = item?.containers || [];
      const containerNames = containers.map((c) => c.name).filter((n): n is string => !!n);
      setContainer(containerNames[0] || "");
      setExpandedContainers(() => {
        const next: Record<string, boolean> = {};
        const unhealthy = containers
          .filter((c) => !isContainerHealthy(c))
          .map((c) => c.name)
          .filter((n): n is string => !!n);
        if (unhealthy.length > 0) {
          unhealthy.forEach((n) => {
            next[n] = true;
          });
        } else if (containerNames[0]) {
          next[containerNames[0]] = true;
        }
        return next;
      });
      setEnvQueryByContainer({});
      setEnvShowRawByContainer({});
      setEventsContainerFilter("");

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, name, ns, props.token, retryNonce]);

  useEffect(() => {
    if (!props.open || !name || tab !== 3) return;
    if (networkingServicesLoading || networkingServicesLoaded) return;

    setNetworkingServicesLoading(true);
    setNetworkingServicesErr(null);

    apiGet<any>(`/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/services`, props.token)
      .then((res) => {
        const items: PodNetworkingService[] = res?.items || [];
        setNetworkingServices(items);
      })
      .catch((e) => setNetworkingServicesErr(toApiError(e)))
      .finally(() => {
        setNetworkingServicesLoading(false);
        setNetworkingServicesLoaded(true);
      });
  }, [props.open, name, ns, props.token, tab, networkingServicesLoading, networkingServicesLoaded]);

  useEffect(() => {
    if (!props.open || !name || tab !== 3) return;
    if (!networkingServicesLoaded) return;
    if (networkingServicesErr) {
      setNetworkingIngressesErr(networkingServicesErr);
      setNetworkingIngressesLoaded(true);
      return;
    }
    if (networkingIngressesLoading || networkingIngressesLoaded) return;

    if (networkingServices.length === 0) {
      setNetworkingIngresses([]);
      setNetworkingIngressesLoaded(true);
      return;
    }

    setNetworkingIngressesLoading(true);
    setNetworkingIngressesErr(null);

    (async () => {
      const results = await Promise.allSettled(
        networkingServices.map((svc) =>
          apiGet<any>(
            `/api/namespaces/${encodeURIComponent(svc.namespace)}/services/${encodeURIComponent(svc.name)}/ingresses`,
            props.token
          )
        )
      );

      const items: PodNetworkingIngress[] = [];
      let firstError: ApiError | null = null;
      results.forEach((res) => {
        if (res.status === "fulfilled") {
          const ingresses: PodNetworkingIngress[] = res.value?.items || [];
          ingresses.forEach((ing) => items.push(ing));
        } else if (!firstError) {
          firstError = toApiError(res.reason);
        }
      });

      if (items.length === 0 && firstError) {
        setNetworkingIngressesErr(firstError);
        setNetworkingIngresses([]);
        return;
      }

      const dedup = new Map<string, PodNetworkingIngress>();
      items.forEach((ing) => {
        if (!ing?.name) return;
        const key = `${ing.namespace}/${ing.name}`;
        if (!dedup.has(key)) {
          dedup.set(key, ing);
        }
      });
      const next = Array.from(dedup.values()).sort((a, b) => {
        if (a.namespace === b.namespace) return a.name.localeCompare(b.name);
        return a.namespace.localeCompare(b.namespace);
      });
      setNetworkingIngresses(next);
    })()
      .catch((e) => {
        setNetworkingIngressesErr(toApiError(e));
        setNetworkingIngresses([]);
      })
      .finally(() => {
        setNetworkingIngressesLoading(false);
        setNetworkingIngressesLoaded(true);
      });
  }, [
    props.open,
    name,
    ns,
    props.token,
    tab,
    networkingServicesLoaded,
    networkingServicesLoading,
    networkingServices,
    networkingServicesErr,
    networkingIngressesLoaded,
    networkingIngressesLoading,
  ]);

  const renderedLogs = useMemo(() => {
    const q = logsFilter.trim().toLowerCase();

    const filtered = q
      ? logLines.filter((l) => l.toLowerCase().includes(q))
      : logLines;

    const limited = lineLimit > 0 ? filtered.slice(-lineLimit) : filtered;

    if (!pretty) {
      return limited.join("\n");
    }

    // Pretty: try parse each line as JSON; if parsed -> pretty multi-line
    // If not JSON -> keep as-is line.
    return formatPretty(limited);
  }, [logLines, logsFilter, pretty, lineLimit]);

  useEffect(() => {
    if (!following) return;
    const el = logScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [renderedLogs, following]);

  const summary = details?.summary;
  const hasUnhealthyConditions = (details?.conditions || []).some((c) => !isConditionHealthy(c));
  const eventContainers = (details?.containers || []).map((c) => c.name).filter((n): n is string => !!n);
  const filteredEvents = useMemo(() => {
    if (!eventsContainerFilter) return events;
    return events.filter((e) => parseContainerFromFieldPath(e.fieldPath) === eventsContainerFilter);
  }, [events, eventsContainerFilter]);

  // Thresholds for "pod restarting frequently" warning
  const RESTART_THRESHOLD = 5;
  const YOUNG_POD_AGE_SEC = 30 * 60; // 30 minutes

  const podWarnings = useMemo((): Warning[] => {
    const warnings: Warning[] = [];
    if (!details) return warnings;

    const containers = details.containers || [];
    const summary = details.summary;
    const podAgeSec = summary?.ageSec ?? 0;

    // Sum total restarts across all containers
    const totalRestarts = containers.reduce((sum, c) => sum + (c.restartCount ?? 0), 0);

    // Find containers with high restarts and their termination reasons
    const highRestartContainers = containers.filter((c) => (c.restartCount ?? 0) >= RESTART_THRESHOLD);

    // Warn if total restarts >= 5 AND pod age <= 30 minutes (young pod with many restarts)
    if (totalRestarts >= RESTART_THRESHOLD && podAgeSec <= YOUNG_POD_AGE_SEC) {
      const terminationReasons = highRestartContainers
        .filter((c) => c.lastTerminationReason)
        .map((c) => `${c.name}: ${c.lastTerminationReason}`)
        .slice(0, 3); // Limit to 3 reasons

      warnings.push({
        message: `Pod is restarting frequently (${totalRestarts} restarts in ${Math.floor(podAgeSec / 60)}m).`,
        detail: terminationReasons.length > 0 ? `Last termination: ${terminationReasons.join(", ")}` : undefined,
      });
    }
    // Also warn if any single container has high restarts regardless of pod age (chronic issue)
    else if (highRestartContainers.length > 0) {
      const containerInfo = highRestartContainers
        .map((c) => {
          const reason = c.lastTerminationReason ? ` (${c.lastTerminationReason})` : "";
          return `${c.name}: ${c.restartCount ?? 0} restarts${reason}`;
        })
        .slice(0, 3); // Limit to 3 containers

      warnings.push({
        message: `Container(s) restarting frequently.`,
        detail: containerInfo.join(", "),
      });
    }

    // Phase vs health confusion hint:
    // If phase is Succeeded but there are explicit unhealthy signals, add a subtle note.
    if (summary?.phase === "Succeeded") {
      const conditions = details.conditions || [];
      const hasUnhealthyCond = conditions.some((c) => c.status !== "True");
      const hasWaitingContainer = containers.some(
        (c) => c.state === "Waiting" && c.reason
      );
      const hasWarningEvents = (events || []).some((e) => e.type === "Warning");

      if (hasUnhealthyCond || hasWaitingContainer || hasWarningEvents) {
        warnings.push({
          message:
            "Pod phase is Succeeded, but some conditions/events indicate issues.",
          detail:
            "This can happen with short-lived pods (e.g., init containers, Jobs) where phase reflects completion but conditions/events captured earlier problems.",
        });
      }
    }

    return warnings;
  }, [details, events]);

  const openController = (kind: string, name: string) => {
    switch (kind) {
      case "ReplicaSet":
        setDrawerReplicaSet(name);
        return;
      case "Deployment":
        setDrawerDeployment(name);
        return;
      case "StatefulSet":
        setDrawerStatefulSet(name);
        return;
      case "DaemonSet":
        setDrawerDaemonSet(name);
        return;
      case "Job":
        setDrawerJob(name);
        return;
      default:
        return;
    }
  };
  const summaryItems = useMemo(
    () => [
      {
        label: "Phase",
        value: summary?.phase ? (
          <Chip size="small" label={summary.phase} color={phaseChipColor(summary.phase)} />
        ) : (
          "-"
        ),
      },
      { label: "Ready", value: valueOrDash(summary?.ready) },
      {
        label: "Restarts",
        value:
          summary?.restarts !== undefined
            ? `${summary.restarts} (max ${summary.maxRestarts ?? 0})`
            : "-",
      },
      {
        label: "Node",
        value: summary?.node ? (
          <ResourceLinkChip label={summary.node} onClick={() => setDrawerNode(summary.node)} />
        ) : (
          "-"
        ),
      },
      { label: "Pod IP", value: valueOrDash(summary?.podIP) },
      { label: "Host IP", value: valueOrDash(summary?.hostIP) },
      { label: "QoS Class", value: valueOrDash(summary?.qosClass) },
      { label: "Start Time", value: summary?.startTime ? fmtTs(summary.startTime) : "-" },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      {
        label: "Controller",
        value:
          summary?.controllerKind && summary?.controllerName ? (
            <ResourceLinkChip
              label={`${summary.controllerKind}/${summary.controllerName}`}
              onClick={
                ["ReplicaSet", "Deployment", "StatefulSet", "DaemonSet", "Job"].includes(summary.controllerKind)
                  ? () => openController(summary.controllerKind, summary.controllerName)
                  : undefined
              }
              sx={
                ["ReplicaSet", "Deployment", "StatefulSet", "DaemonSet", "Job"].includes(summary.controllerKind)
                  ? undefined
                  : { opacity: 0.6 }
              }
            />
          ) : (
            "-"
          ),
      },
      {
        label: "Service Account",
        value: summary?.serviceAccount ? (
          <ResourceLinkChip
            label={summary.serviceAccount}
            onClick={() => setDrawerServiceAccount(summary.serviceAccount)}
          />
        ) : (
          "-"
        ),
      },
    ],
    [summary]
  );
  const servicesAccessDenied =
    networkingServicesErr?.status === 401 || networkingServicesErr?.status === 403;
  const ingressesAccessDenied =
    networkingIngressesErr?.status === 401 || networkingIngressesErr?.status === 403;

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Pod: {name || "-"}{" "}
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
              <Tab label="Containers" />
              <Tab label="Resources" />
              <Tab label="Networking" />
              <Tab label="Events" />
              <Tab label="YAML" />
              <Tab label="Logs" />
            </Tabs>

            <Box sx={{ mt: 3, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <PodActions
                        token={props.token}
                        namespace={ns}
                        podName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <WarningsSection warnings={podWarnings} />

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <ConditionsTable
                    conditions={details?.conditions || []}
                    title="Health & Conditions"
                  />

                  <Accordion
                    defaultExpanded={
                      !!details?.lifecycle?.priorityClass ||
                      !!details?.lifecycle?.preemptionPolicy ||
                      !!details?.lifecycle?.affinitySummary ||
                      Object.keys(details?.lifecycle?.nodeSelector || {}).length > 0 ||
                      (details?.lifecycle?.tolerations || []).length > 0
                    }
                  >
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Lifecycle & Scheduling</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <KeyValueTable
                        columns={2}
                        rows={[
                          { label: "Restart Policy", value: details?.lifecycle?.restartPolicy },
                          { label: "Priority Class", value: details?.lifecycle?.priorityClass },
                          { label: "Preemption Policy", value: details?.lifecycle?.preemptionPolicy },
                          { label: "Affinity", value: details?.lifecycle?.affinitySummary },
                        ]}
                      />

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Node Selectors
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                          {Object.entries(details?.lifecycle?.nodeSelector || {}).length === 0 ? (
                            <EmptyState message="None" />
                          ) : (
                            Object.entries(details?.lifecycle?.nodeSelector || {}).map(([k, v]) => (
                              <Chip key={k} size="small" label={`${k}=${v}`} />
                            ))
                          )}
                        </Box>
                      </Box>

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Tolerations
                        </Typography>
                        {(details?.lifecycle?.tolerations || []).length === 0 ? (
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
                              {(details?.lifecycle?.tolerations || []).map((t, idx) => (
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
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* CONTAINERS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
                  {(details?.containers || []).length === 0 ? (
                    <EmptyState message="No containers found for this Pod." />
                  ) : (
                    (details?.containers || []).map((ctn, idx) => {
                      const unhealthy = !isContainerHealthy(ctn);
                      const containerKey = ctn.name ?? String(idx);
                      const envQuery = envQueryByContainer[containerKey] || "";
                      const showRaw = envShowRawByContainer[containerKey] || false;
                      const envFiltered = (ctn.env || []).filter((e) =>
                        String(e.name ?? "").toLowerCase().includes(envQuery.toLowerCase())
                      );

                      return (
                        <Accordion
                          key={containerKey}
                          expanded={!!expandedContainers[containerKey]}
                          onChange={() =>
                            setExpandedContainers((prev) => ({
                              ...prev,
                              [containerKey]: !prev[containerKey],
                            }))
                          }
                          sx={{
                            border: unhealthy ? "1px solid rgba(211, 47, 47, 0.6)" : "1px solid transparent",
                          }}
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flexGrow: 1 }}>
                              <Typography variant="subtitle2">{valueOrDash(ctn.name)}</Typography>
                              <Chip size="small" label={ctn.state || "Unknown"} color={containerStateColor(ctn.state)} />
                              <Chip
                                size="small"
                                label={ctn.ready ? "Ready" : "Not Ready"}
                                color={ctn.ready ? "success" : "warning"}
                              />
                              <Chip size="small" label={`Restarts: ${ctn.restartCount ?? 0}`} />
                              {unhealthy && <Chip size="small" color="error" label="Attention" />}
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <Section title="Runtime" dividerPlacement="content">
                                <KeyValueTable
                                  columns={3}
                                  sx={{ mt: 1 }}
                                  rows={[
                                    {
                                      label: "Image",
                                      value: ctn.imageId ? (
                                        <Tooltip title={`Image ID: ${ctn.imageId}`} arrow>
                                          <Typography
                                            variant="body2"
                                            sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                                          >
                                            {valueOrDash(ctn.image)}
                                          </Typography>
                                        </Tooltip>
                                      ) : (
                                        <Typography
                                          variant="body2"
                                          sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                                        >
                                          {valueOrDash(ctn.image)}
                                        </Typography>
                                      ),
                                    },
                                    {
                                      label: "State",
                                      value: ctn.state ? (
                                        <Chip size="small" label={ctn.state} color={containerStateColor(ctn.state)} />
                                      ) : (
                                        "-"
                                      ),
                                    },
                                    { label: "Reason", value: valueOrDash(ctn.reason) },
                                    {
                                      label: "Message",
                                      value: (
                                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                                          {valueOrDash(ctn.message)}
                                        </Typography>
                                      ),
                                    },
                                    { label: "Started At", value: ctn.startedAt ? fmtTs(ctn.startedAt) : "-" },
                                    { label: "Finished At", value: ctn.finishedAt ? fmtTs(ctn.finishedAt) : "-" },
                                    { label: "Last Termination Reason", value: valueOrDash(ctn.lastTerminationReason) },
                                    {
                                      label: "Last Termination Message",
                                      value: (
                                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                                          {valueOrDash(ctn.lastTerminationMessage)}
                                        </Typography>
                                      ),
                                    },
                                    { label: "Last Termination At", value: ctn.lastTerminationAt ? fmtTs(ctn.lastTerminationAt) : "-" },
                                  ]}
                                />
                              </Section>

                              <Section title="Resources" dividerPlacement="content">
                                <KeyValueTable
                                  columns={2}
                                  sx={{ mt: 1 }}
                                  rows={[
                                    {
                                      label: "CPU Requests / Limits",
                                      value: `${valueOrDash(ctn.resources?.cpuRequest)} / ${valueOrDash(ctn.resources?.cpuLimit)}`,
                                    },
                                    {
                                      label: "Memory Requests / Limits",
                                      value: `${valueOrDash(ctn.resources?.memoryRequest)} / ${valueOrDash(ctn.resources?.memoryLimit)}`,
                                    },
                                    { label: "QoS Impact", value: valueOrDash(summary?.qosClass) },
                                  ]}
                                />
                              </Section>

                              <Section
                                title="Environment"
                                dividerPlacement="content"
                                actions={
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <TextField
                                      size="small"
                                      label="Filter"
                                      value={envQuery}
                                      onChange={(e) =>
                                        setEnvQueryByContainer((prev) => ({
                                          ...prev,
                                          [containerKey]: e.target.value,
                                        }))
                                      }
                                    />
                                    <FormControlLabel
                                      control={
                                        <Switch
                                          checked={showRaw}
                                          onChange={(e) =>
                                            setEnvShowRawByContainer((prev) => ({
                                              ...prev,
                                              [containerKey]: e.target.checked,
                                            }))
                                          }
                                        />
                                      }
                                      label="Raw values"
                                    />
                                  </Box>
                                }
                              >
                                {(ctn.env || []).length === 0 ? (
                                  <EmptyState message="No environment variables." sx={{ mt: 1 }} />
                                ) : envFiltered.length === 0 ? (
                                  <EmptyState message="No environment variables match the filter." sx={{ mt: 1 }} />
                                ) : (
                                  <Table size="small" sx={{ mt: 1 }}>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Name</TableCell>
                                        <TableCell>Value</TableCell>
                                        <TableCell>Source</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {envFiltered.map((e, envIdx) => (
                                        <TableRow key={`${containerKey}-env-${e.name ?? envIdx}`}>
                                          <TableCell>{valueOrDash(e.name)}</TableCell>
                                          <TableCell>
                                            {e.source === "Value"
                                              ? valueOrDash(e.value)
                                              : showRaw
                                              ? valueOrDash(e.sourceRef)
                                              : valueOrDash(e.source)}
                                          </TableCell>
                                          <TableCell>
                                            {e.source === "Value" ? "Literal" : valueOrDash(e.source)}
                                            {e.optional ? " (optional)" : ""}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </Section>

                              <Section title="Mounts & Volumes" dividerPlacement="content">
                                {(ctn.mounts || []).length === 0 ? (
                                  <EmptyState message="No mounts defined." sx={{ mt: 1 }} />
                                ) : (
                                  <Table size="small" sx={{ mt: 1 }}>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Mount Path</TableCell>
                                        <TableCell>Volume</TableCell>
                                        <TableCell>Mode</TableCell>
                                        <TableCell>SubPath</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(ctn.mounts || []).map((m, mountIdx) => (
                                        <TableRow key={`${containerKey}-${m.mountPath ?? mountIdx}`}>
                                          <TableCell>{valueOrDash(m.mountPath)}</TableCell>
                                          <TableCell>{valueOrDash(m.name)}</TableCell>
                                          <TableCell>
                                            {m.readOnly === undefined ? "-" : m.readOnly ? "ReadOnly" : "ReadWrite"}
                                          </TableCell>
                                          <TableCell>{valueOrDash(m.subPath)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                )}
                              </Section>

                              <Section title="Probes" divider={false}>
                                <Table size="small" sx={{ mt: 1 }}>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Probe</TableCell>
                                      <TableCell>Type / Target</TableCell>
                                      <TableCell>Initial Delay</TableCell>
                                      <TableCell>Period</TableCell>
                                      <TableCell>Timeout</TableCell>
                                      <TableCell>Failure / Success</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {[
                                      { label: "Liveness", probe: ctn.probes?.liveness },
                                      { label: "Readiness", probe: ctn.probes?.readiness },
                                      { label: "Startup", probe: ctn.probes?.startup },
                                    ].map((p) => (
                                      <TableRow key={`${containerKey}-${p.label}`}>
                                        <TableCell>{p.label}</TableCell>
                                        <TableCell>{formatProbeDetails(p.probe)}</TableCell>
                                        <TableCell>{p.probe?.initialDelaySeconds ?? "-"}</TableCell>
                                        <TableCell>{p.probe?.periodSeconds ?? "-"}</TableCell>
                                        <TableCell>{p.probe?.timeoutSeconds ?? "-"}</TableCell>
                                        <TableCell>
                                          {p.probe
                                            ? `${p.probe.failureThreshold ?? "-"} / ${p.probe.successThreshold ?? "-"}`
                                            : "-"}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Section>
                            </Box>
                          </AccordionDetails>
                        </Accordion>
                      );
                    })
                  )}
                </Box>
              )}

              {/* RESOURCES */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Volumes</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.resources?.volumes || []).length === 0 ? (
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
                            {(details?.resources?.volumes || []).map((v, idx) => (
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
                      <Typography variant="subtitle2">Image Pull Secrets</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.resources?.imagePullSecrets || []).length === 0 ? (
                        <EmptyState message="No image pull secrets." />
                      ) : (
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                          {(details?.resources?.imagePullSecrets || [])
                            .filter((s): s is string => !!s)
                            .map((s) => (
                              <Chip key={s} size="small" label={s} />
                            ))}
                        </Box>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Security Context</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Typography variant="caption" color="text.secondary">
                        Pod Security Context
                      </Typography>
                      <KeyValueTable
                        columns={3}
                        sx={{ mt: 0.5 }}
                        rows={[
                          { label: "RunAsUser", value: details?.resources?.podSecurityContext?.runAsUser },
                          { label: "RunAsGroup", value: details?.resources?.podSecurityContext?.runAsGroup },
                          { label: "FSGroup", value: details?.resources?.podSecurityContext?.fsGroup },
                          {
                            label: "FSGroup Change Policy",
                            value: details?.resources?.podSecurityContext?.fsGroupChangePolicy,
                          },
                          { label: "Seccomp Profile", value: details?.resources?.podSecurityContext?.seccompProfile },
                          {
                            label: "Supplemental Groups",
                            value:
                              (details?.resources?.podSecurityContext?.supplementalGroups || []).length === 0
                                ? "-"
                                : (details?.resources?.podSecurityContext?.supplementalGroups || []).join(", "),
                          },
                        ]}
                      />

                      {(details?.resources?.podSecurityContext?.sysctls || []).length > 0 && (
                        <Box sx={{ mt: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            Sysctls
                          </Typography>
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Name</TableCell>
                                <TableCell>Value</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                            {(details?.resources?.podSecurityContext?.sysctls || []).map((s, idx) => (
                              <TableRow key={s.name || String(idx)}>
                                <TableCell>{valueOrDash(s.name)}</TableCell>
                                <TableCell>{valueOrDash(s.value)}</TableCell>
                              </TableRow>
                            ))}
                            </TableBody>
                          </Table>
                        </Box>
                      )}

                      <Box sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          Container Overrides
                        </Typography>
                        {(details?.resources?.containerSecurityContexts || []).length === 0 ? (
                          <EmptyState message="No container overrides." sx={{ mt: 0.5 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 0.5 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Container</TableCell>
                                <TableCell>RunAsUser</TableCell>
                                <TableCell>RunAsGroup</TableCell>
                                <TableCell>Privileged</TableCell>
                                <TableCell>ReadOnlyRootFS</TableCell>
                                <TableCell>AllowPrivilegeEscalation</TableCell>
                                <TableCell>Capabilities</TableCell>
                                <TableCell>Seccomp</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                            {(details?.resources?.containerSecurityContexts || []).map((c, idx) => (
                              <TableRow key={`${c.name ?? "container"}-${idx}`}>
                                <TableCell>{valueOrDash(c.name)}</TableCell>
                                  <TableCell>{valueOrDash(c.runAsUser)}</TableCell>
                                  <TableCell>{valueOrDash(c.runAsGroup)}</TableCell>
                                  <TableCell>{valueOrDash(c.privileged)}</TableCell>
                                  <TableCell>{valueOrDash(c.readOnlyRootFilesystem)}</TableCell>
                                  <TableCell>{valueOrDash(c.allowPrivilegeEscalation)}</TableCell>
                                  <TableCell>
                                    {[
                                      ...(c.capabilitiesAdd || []).map((cap) => `+${cap}`),
                                      ...(c.capabilitiesDrop || []).map((cap) => `-${cap}`),
                                    ].join(", ") || "-"}
                                  </TableCell>
                                  <TableCell>{valueOrDash(c.seccompProfile)}</TableCell>
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
                      <Typography variant="subtitle2">DNS & Host Aliases</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ mb: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          DNS Policy
                        </Typography>
                        <Typography variant="body2">{valueOrDash(details?.resources?.dnsPolicy)}</Typography>
                      </Box>
                      {(details?.resources?.hostAliases || []).length === 0 ? (
                        <EmptyState message="No host aliases." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>IP</TableCell>
                              <TableCell>Hostnames</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.resources?.hostAliases || []).map((h, idx) => (
                              <TableRow key={`${h.ip ?? "host"}-${idx}`}>
                                <TableCell>{valueOrDash(h.ip)}</TableCell>
                                <TableCell>{(h.hostnames || []).join(", ") || "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Topology Spread Constraints</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {(details?.resources?.topologySpreadConstraints || []).length === 0 ? (
                        <EmptyState message="No topology spread constraints." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Topology Key</TableCell>
                              <TableCell>Max Skew</TableCell>
                              <TableCell>When Unsatisfiable</TableCell>
                              <TableCell>Label Selector</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.resources?.topologySpreadConstraints || []).map((t, idx) => (
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
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* NETWORKING */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
                  <Accordion defaultExpanded={networkingServices.length > 0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Services</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {networkingServicesLoading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
                          <CircularProgress size={22} />
                        </Box>
                      ) : servicesAccessDenied ? (
                        <AccessDeniedState status={networkingServicesErr?.status} resourceLabel="Services" />
                      ) : networkingServicesErr ? (
                        <ErrorState message={networkingServicesErr.message} />
                      ) : networkingServices.length === 0 ? (
                        <EmptyState message="No Services select this Pod." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Type</TableCell>
                              <TableCell>Selector</TableCell>
                              <TableCell>Ports</TableCell>
                              <TableCell>Endpoints</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {networkingServices.map((svc) => (
                              <TableRow
                                key={`${svc.namespace}/${svc.name}`}
                                hover
                                onClick={() => svc.name && setDrawerService(svc.name)}
                                sx={{ cursor: svc.name ? "pointer" : "default" }}
                              >
                                <TableCell>{valueOrDash(svc.name)}</TableCell>
                                <TableCell>{valueOrDash(svc.type)}</TableCell>
                                <TableCell>
                                  {Object.entries(svc.selector || {}).length === 0 ? (
                                    "-"
                                  ) : (
                                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                                      {Object.entries(svc.selector || {}).map(([k, v]) => (
                                        <Tooltip key={`${svc.name}-${k}`} title={`${k}=${v}`} arrow>
                                          <Chip size="small" label={`${k}=${v}`} />
                                        </Tooltip>
                                      ))}
                                    </Box>
                                  )}
                                </TableCell>
                                <TableCell>{valueOrDash(svc.portsSummary)}</TableCell>
                                <TableCell>
                                  {`${svc.endpointsReady ?? 0} ready / ${svc.endpointsNotReady ?? 0} not ready`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion defaultExpanded={networkingIngresses.length > 0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="subtitle2">Ingresses</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {networkingIngressesLoading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", mt: 1 }}>
                          <CircularProgress size={22} />
                        </Box>
                      ) : ingressesAccessDenied ? (
                        <AccessDeniedState status={networkingIngressesErr?.status} resourceLabel="Ingresses" />
                      ) : networkingIngressesErr ? (
                        <ErrorState message={networkingIngressesErr.message} />
                      ) : networkingIngresses.length === 0 ? (
                        <EmptyState message="No Ingresses found for these Services." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Class</TableCell>
                              <TableCell>Hosts</TableCell>
                              <TableCell>TLS</TableCell>
                              <TableCell>Address</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {networkingIngresses.map((ing) => (
                              <TableRow
                                key={`${ing.namespace}/${ing.name}`}
                                hover
                                onClick={() =>
                                  ing.name && ing.namespace ? setDrawerIngress({ name: ing.name, namespace: ing.namespace }) : null
                                }
                                sx={{ cursor: ing.name ? "pointer" : "default" }}
                              >
                                <TableCell>{valueOrDash(ing.name)}</TableCell>
                                <TableCell>
                                  <Chip size="small" label={valueOrDash(ing.ingressClassName)} />
                                </TableCell>
                                <TableCell>{formatIngressHostsSummary(ing.hosts)}</TableCell>
                                <TableCell>
                                  <Chip size="small" label={formatIngressTlsLabel(ing.tlsCount)} />
                                </TableCell>
                                <TableCell>{formatIngressAddresses(ing.addresses)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </AccordionDetails>
                  </Accordion>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 4 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel id="events-container-label" shrink>Container</InputLabel>
                      <Select
                        labelId="events-container-label"
                        label="Container"
                        displayEmpty
                        value={eventsContainerFilter}
                        onChange={(e) => setEventsContainerFilter(String(e.target.value))}
                      >
                        <MenuItem value="">All containers</MenuItem>
                        {eventContainers.map((c) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  {filteredEvents.length === 0 ? (
                    <EmptyState message="No events found for this Pod." />
                  ) : (
                    filteredEvents.map((e, idx) => (
                      <Box key={idx} sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.25 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                            <Chip size="small" label={e.type || "Unknown"} color={eventChipColor(e.type)} />
                            <Typography variant="subtitle2">
                              {valueOrDash(e.reason)} (x{valueOrDash(e.count)})
                            </Typography>
                            {parseContainerFromFieldPath(e.fieldPath) && (
                              <Chip size="small" label={parseContainerFromFieldPath(e.fieldPath)} />
                            )}
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            {fmtTs(e.lastSeen)}
                          </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
                          {valueOrDash(e.message)}
                        </Typography>
                      </Box>
                    ))
                  )}
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}

              {/* LOGS */}
              {tab === 6 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%" }}>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                    <FormControl size="small" sx={{ minWidth: 220 }}>
                      <InputLabel id="container-label">Container</InputLabel>
                      <Select
                        labelId="container-label"
                        label="Container"
                        value={container}
                        onChange={(e) => setContainer(String(e.target.value))}
                      >
                        {(details?.containers || [])
                          .map((c) => c.name)
                          .filter((n): n is string => !!n)
                          .map((name) => (
                            <MenuItem key={name} value={name}>
                              {name}
                            </MenuItem>
                          ))}
                        {(!details?.containers || details.containers.length === 0) && (
                          <MenuItem value="">(no containers)</MenuItem>
                        )}
                      </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel id="lines-label">Lines</InputLabel>
                      <Select
                        labelId="lines-label"
                        label="Lines"
                        value={lineLimit}
                        onChange={(e) => setLineLimit(Number(e.target.value))}
                      >
                        {[100, 500, 1000, 5000].map((n) => (
                          <MenuItem key={n} value={n}>
                            {n}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <TextField
                      size="small"
                      label="Filter pattern"
                      value={logsFilter}
                      onChange={(e) => setLogsFilter(e.target.value)}
                      sx={{ minWidth: 240 }}
                    />

                    <FormControlLabel
                      control={<Switch checked={pretty} onChange={(e) => setPretty(e.target.checked)} />}
                      label="Pretty"
                    />

                    <FormControlLabel
                      control={<Switch checked={wrapLines} onChange={(e) => setWrapLines(e.target.checked)} />}
                      label="Wrap lines"
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={following}
                          onChange={(e) => {
                            if (e.target.checked) {
                              startLogsFollow();
                            } else {
                              stopLogs();
                            }
                          }}
                          disabled={!name}
                        />
                      }
                      label="Follow"
                    />
                  </Box>

                  <Box
                    ref={logScrollRef}
                    sx={{
                      border: "1px solid var(--code-border)",
                      borderRadius: 2,
                      overflow: "auto",
                      flexGrow: 1,
                      backgroundColor: "var(--code-bg)",
                      color: "var(--code-text)",
                    }}
                  >
                    <SyntaxHighlighter
                      key={`${pretty}-${wrapLines}`}
                      language={pretty ? "json" : "text"}
                      wrapLongLines={wrapLines}
                      customStyle={{
                        margin: 0,
                        background: "transparent",
                        whiteSpace: wrapLines ? "pre-wrap" : "pre",
                        color: "var(--code-text)",
                      }}
                      codeTagProps={{
                        style: {
                          whiteSpace: wrapLines ? "pre-wrap" : "pre",
                          color: "var(--code-text)",
                        },
                      }}
                    >
                      {renderedLogs || ""}
                    </SyntaxHighlighter>
                  </Box>
                </Box>
              )}
            </Box>
            <ServiceDrawer
              open={!!drawerService}
              onClose={() => setDrawerService(null)}
              token={props.token}
              namespace={ns}
              serviceName={drawerService}
            />
            <IngressDrawer
              open={!!drawerIngress}
              onClose={() => setDrawerIngress(null)}
              token={props.token}
              namespace={drawerIngress?.namespace || ns}
              ingressName={drawerIngress?.name || null}
            />
            <ReplicaSetDrawer
              open={!!drawerReplicaSet}
              onClose={() => setDrawerReplicaSet(null)}
              token={props.token}
              namespace={ns}
              replicaSetName={drawerReplicaSet}
            />
            <DeploymentDrawer
              open={!!drawerDeployment}
              onClose={() => setDrawerDeployment(null)}
              token={props.token}
              namespace={ns}
              deploymentName={drawerDeployment}
            />
            <StatefulSetDrawer
              open={!!drawerStatefulSet}
              onClose={() => setDrawerStatefulSet(null)}
              token={props.token}
              namespace={ns}
              statefulSetName={drawerStatefulSet}
            />
            <DaemonSetDrawer
              open={!!drawerDaemonSet}
              onClose={() => setDrawerDaemonSet(null)}
              token={props.token}
              namespace={ns}
              daemonSetName={drawerDaemonSet}
            />
            <JobDrawer
              open={!!drawerJob}
              onClose={() => setDrawerJob(null)}
              token={props.token}
              namespace={ns}
              jobName={drawerJob}
            />
            <NodeDrawer
              open={!!drawerNode}
              onClose={() => setDrawerNode(null)}
              token={props.token}
              nodeName={drawerNode}
            />
            <ServiceAccountDrawer
              open={!!drawerServiceAccount}
              onClose={() => setDrawerServiceAccount(null)}
              token={props.token}
              namespace={ns}
              serviceAccountName={drawerServiceAccount}
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
    </RightDrawer>
  );
}

