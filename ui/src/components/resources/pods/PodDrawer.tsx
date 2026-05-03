import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
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
  Button,
  IconButton,
  Menu,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloseIcon from "@mui/icons-material/Close";
import CableIcon from "@mui/icons-material/Cable";
import DownloadIcon from "@mui/icons-material/Download";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import TerminalIcon from "@mui/icons-material/Terminal";
import { apiGet, toApiError, type ApiError } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { fmtAge, fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import CodeBlock from "../../shared/CodeBlock";
import IngressDrawer from "../ingresses/IngressDrawer";
import ServiceDrawer from "../services/ServiceDrawer";
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import ReplicaSetDrawer from "../replicasets/ReplicaSetDrawer";
import StatefulSetDrawer from "../statefulsets/StatefulSetDrawer";
import DaemonSetDrawer from "../daemonsets/DaemonSetDrawer";
import JobDrawer from "../jobs/JobDrawer";
import NodeDrawer from "../nodes/NodeDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import PodActions from "./PodActions";
import EnvValueDisplay from "./EnvValueDisplay";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
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
  drawerTabContentSx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";
import ServiceAccountDrawer from "../serviceaccounts/ServiceAccountDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import KeyValueTable from "../../shared/KeyValueTable";
import AccessDeniedState from "../../shared/AccessDeniedState";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import KeyValueChip from "../../shared/KeyValueChip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ContainerImageLabel from "../../shared/ContainerImageLabel";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import InfoHint from "../../shared/InfoHint";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import StatusChip from "../../shared/StatusChip";
import EventsPanel from "../../shared/EventsPanel";
import { formatCPUMilli, formatMemoryBytes, formatPct, severityForPct } from "../../metrics/format";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import PortForwardDialog, { type PortForwardOption } from "../../shared/PortForwardDialog";
import PortForwardCreatedSnackbar from "../../shared/PortForwardCreatedSnackbar";
import { createTerminalSession, createPortForwardSession, runContainerCommand, type RunContainerCommandResult } from "../../../sessionsApi";
import { emitFocusPortForwardsTab, emitOpenTerminalSession } from "../../../activityEvents";
import { useActiveContext } from "../../../activeContext";
import { useUserSettings } from "../../../settingsContext";
import { useKeyboardControls } from "../../../keyboard/KeyboardProvider";
import { customCommandsForContainer, type CustomCommandDefinition } from "../../../settings";
import { useMutationDialog } from "../../mutations/useMutationDialog";
import type { ExecuteActionResult } from "../../../lib/actions/types";

type PodDetails = {
  summary: PodSummary;
  conditions: PodCondition[];
  lifecycle: PodLifecycle;
  containers: PodContainer[];
  resources: PodResources;
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  yaml: string;
};

// Response envelope for the pod details endpoint. The endpoint embeds
// backend-derived detail-level signals (e.g. pod_young_frequent_restarts,
// pod_succeeded_with_issues) alongside the item so the Overview tab can
// merge them with snapshot-level signals from useResourceSignals.
type PodDetailsResponse = ApiItemResponse<PodDetails> & {
  detailSignals?: DashboardSignalItem[];
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
  /** Optional usage merged from metrics.k8s.io on the detail endpoint. */
  usage?: {
    cpuMilli: number;
    memoryBytes: number;
    cpuPctRequest?: number;
    cpuPctLimit?: number;
    memoryPctRequest?: number;
    memoryPctLimit?: number;
  };
  ports?: {
    name?: string;
    containerPort: number;
    protocol?: string;
  }[];
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

// WebSocket URLs use query token: browser WebSocket API cannot set Authorization header.
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

function usageGaugeTone(pct: number | undefined): GaugeTone {
  switch (severityForPct(pct)) {
    case "critical":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

function isContainerHealthy(ctn: PodContainer) {
  if (!ctn.ready) return false;
  if (!ctn.state) return false;
  return ctn.state === "Running";
}

function isContainerActionAvailable(ctn: PodContainer | undefined) {
  return ctn?.state === "Running";
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

function parseKeyValueOutput(text: string): { rows: Array<{ key: string; value: string }>; parseable: boolean } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: Array<{ key: string; value: string }> = [];
  let parsedCount = 0;
  for (const line of lines) {
    const delimiterMatch = line.match(/^([^=:\s,]+)\s*(=|:|,|\s)\s*(.+)$/);
    if (!delimiterMatch) continue;
    parsedCount += 1;
    rows.push({ key: delimiterMatch[1], value: delimiterMatch[3] ?? "" });
  }
  return {
    rows,
    parseable: lines.length > 0 && parsedCount / lines.length >= 0.8,
  };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimitedOutput(text: string): {
  delimiter: string;
  rows: string[][];
  parseable: boolean;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const delimiters = [",", ";", "\t", "|"];
  let best = { delimiter: ",", rows: [] as string[][], score: 0 };
  for (const delimiter of delimiters) {
    const rows = lines.map((line) => splitDelimitedLine(line, delimiter));
    const multiColumnRows = rows.filter((row) => row.length > 1);
    const widthCounts = new Map<number, number>();
    for (const row of multiColumnRows) {
      widthCounts.set(row.length, (widthCounts.get(row.length) || 0) + 1);
    }
    const consistency = Math.max(0, ...Array.from(widthCounts.values()));
    const score = multiColumnRows.length + consistency;
    if (score > best.score) best = { delimiter, rows, score };
  }
  const parseable = lines.length > 0 && best.rows.filter((row) => row.length > 1).length / lines.length >= 0.8;
  return { delimiter: best.delimiter, rows: best.rows, parseable };
}

function detectCodeLanguage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "text";
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    // keep checking
  }
  if (/^---(?:\s|$)/.test(trimmed) || /^[\w.-]+\s*:\s+.+$/m.test(trimmed)) {
    return "yaml";
  }
  if (/^<\?xml\b|<[\w:-]+(?:\s|>)/.test(trimmed)) return "markup";
  if (/^<\?php\b|\bnamespace\s+[\w\\]+;|\buse\s+[\w\\]+;/.test(trimmed)) return "php";
  if (/\b(import\s+[\w.*{}\s,]+\s+from\s+['"]|const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+\s*\()/m.test(trimmed)) return "javascript";
  if (/\b(public|private|protected)\s+(class|interface|enum)\s+\w+|\bSystem\.out\.println\(/.test(trimmed)) return "java";
  if (/\bpackage\s+main\b|\bfunc\s+\w+\s*\(|\bfmt\.Print/.test(trimmed)) return "go";
  if (/\b(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import\s+|if\s+__name__\s*==\s*["']__main__["'])/m.test(trimmed)) return "python";
  if (/^\s*\[[^\]]+\]\s*$/m.test(trimmed) || /^[\w.-]+\s*=\s*.+$/m.test(trimmed)) return "ini";
  if (parseDelimitedOutput(trimmed).parseable) return "csv";
  if (/^\s*(#!\/bin\/(?:ba)?sh|set -e\b|export\s+\w+=)/m.test(trimmed)) return "bash";
  return "text";
}

function downloadCommandOutput(result: RunContainerCommandResult, fallbackName: string) {
  const fileName = result.fileName || fallbackName || "container-command-output.txt";
  let blob: Blob;
  if (result.outputBase64) {
    const raw = window.atob(result.outputBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: result.compressed ? "application/gzip" : "application/octet-stream" });
  } else {
    blob = new Blob([result.stdout || ""], { type: "text/plain" });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PodDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  podName: string | null;
}) {
  const { health, retryNonce } = useConnectionState();
  const activeContext = useActiveContext();
  const { settings } = useUserSettings();
  const { registerContextActions } = useKeyboardControls();
  const { open: openMutationDialog } = useMutationDialog();
  const offline = health === "unhealthy";
  const offlineReason = "Cluster connection is unavailable";
  const metricsStatus = useMetricsStatus(props.token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<PodDetails | null>(null);
  const [detailSignals, setDetailSignals] = useState<DashboardSignalItem[]>([]);
  const [err, setErr] = useState("");
  const [expandedContainers, setExpandedContainers] = useState<Record<string, boolean>>({});
  const [envQueryByContainer, setEnvQueryByContainer] = useState<Record<string, string>>({});
  const [envShowRefsByContainer, setEnvShowRefsByContainer] = useState<Record<string, boolean>>({});
  const [envPrettyByContainer, setEnvPrettyByContainer] = useState<Record<string, boolean>>({});
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
  const [drawerSecret, setDrawerSecret] = useState<string | null>(null);
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
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const ns = props.namespace;
  const name = props.podName;
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [creatingPortForward, setCreatingPortForward] = useState(false);
  const [terminalContainer, setTerminalContainer] = useState<string>("");
  const [terminalMenuAnchor, setTerminalMenuAnchor] = useState<null | HTMLElement>(null);
  const [commandMenuAnchor, setCommandMenuAnchor] = useState<null | HTMLElement>(null);
  const [commandMenuContainer, setCommandMenuContainer] = useState<string>("");
  const [runningCommand, setRunningCommand] = useState(false);
  const [commandResult, setCommandResult] = useState<{
    command: CustomCommandDefinition;
    container: string;
    result: RunContainerCommandResult;
  } | null>(null);
  const [commandOutputFilter, setCommandOutputFilter] = useState("");
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false);
  const [portForwardRemotePort, setPortForwardRemotePort] = useState<string>("");
  const [portForwardLocalPort, setPortForwardLocalPort] = useState<string>("");
  const [portForwardError, setPortForwardError] = useState<string>("");
  const [portForwardCreatedMsg, setPortForwardCreatedMsg] = useState("");

  const logWsBase = useMemo(() => {
    if (!name) return "";
    return `/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/logs/ws`;
  }, [name, ns]);
  const actionableContainers = useMemo(
    () => (details?.containers || []).filter(isContainerActionAvailable),
    [details],
  );
  const commandContainers = useMemo(
    () =>
      actionableContainers
        .map((c) => c.name)
        .filter((containerName): containerName is string => Boolean(containerName)),
    [actionableContainers],
  );
  const matchingCommandsByContainer = useMemo(() => {
    const out: Record<string, CustomCommandDefinition[]> = {};
    for (const containerName of commandContainers) {
      out[containerName] = customCommandsForContainer(settings.customCommands.commands, containerName);
    }
    return out;
  }, [commandContainers, settings.customCommands.commands]);
  const overviewCommandItems = useMemo(
    () =>
      commandContainers.flatMap((containerName) =>
        (matchingCommandsByContainer[containerName] || []).map((command) => ({ containerName, command })),
      ),
    [commandContainers, matchingCommandsByContainer],
  );

  const stopLogs = useCallback(() => {
    setFollowing(false);
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }, []);

  const startLogsFollow = useCallback(() => {
    if (!name) return;

    stopLogs();
    setLogLines([]);

    const qs = new URLSearchParams();
    if (activeContext) qs.set("context", activeContext);
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
  }, [activeContext, container, lineLimit, logWsBase, name, props.token, stopLogs]);

  // Cleanup on close / pod switch
  useEffect(() => {
    if (!props.open) {
      stopLogs();
      return;
    }
    return () => stopLogs();
  }, [props.open, name, stopLogs]);

  const openTerminalForContainer = async (containerName: string) => {
    const target = (details?.containers || []).find((ctn) => ctn.name === containerName);
    if (!name || !containerName || offline || !isContainerActionAvailable(target)) return;
    try {
      setCreatingTerminal(true);
      const sessionId = await createTerminalSession(
        {
          namespace: ns,
          pod: name,
          container: containerName,
          title: `${name} / ${containerName}`,
        },
        props.token
      );
      emitOpenTerminalSession({
        sessionId,
        source: "pod-drawer",
        namespace: ns,
        pod: name,
        container: containerName,
      });
    } finally {
      setCreatingTerminal(false);
    }
  };

  const runConfiguredCommand = async (containerName: string, command: CustomCommandDefinition) => {
    const target = (details?.containers || []).find((ctn) => ctn.name === containerName);
    if (!name || !containerName || offline || runningCommand || !isContainerActionAvailable(target)) return;
    const label = command.name || command.command;
    openMutationDialog({
      token: props.token,
      targetRef: {
        context: activeContext,
        kind: "Container",
        namespace: ns,
        name: `${name}/${containerName}`,
      },
      descriptor: {
        id: `container-command:${command.id}`,
        title: `Run ${label}`,
        description: [
          `Executes inside container ${containerName}.`,
          command.workdir ? `Workdir: ${command.workdir}.` : "Uses the container default workdir.",
          `Command: ${command.command}`,
        ].join(" "),
        risk: command.safety === "dangerous" ? "high" : "low",
        confirmSpec:
          command.safety === "dangerous"
            ? { mode: "typed", requiredValue: label }
            : { mode: "simple" },
      },
      execute: async (): Promise<ExecuteActionResult> => {
        try {
          setRunningCommand(true);
          const result = await runContainerCommand(
            {
              namespace: ns,
              pod: name,
              container: containerName,
              command: command.command,
              workdir: command.workdir,
              outputType: command.outputType,
              fileName: command.fileName,
              compress: command.compress,
            },
            props.token,
            activeContext,
          );
          return {
            success: true,
            message:
              result.exitCode === 0
                ? "Command completed successfully."
                : `Command completed with exit code ${result.exitCode}.`,
            details: result,
          };
        } catch (e) {
          return {
            success: false,
            message: (e as Error | undefined)?.message || "Failed to run command.",
            details: e,
          };
        } finally {
          setRunningCommand(false);
        }
      },
      onSuccess: (res) => {
        const result = res.details as RunContainerCommandResult | undefined;
        if (!result || typeof result.exitCode !== "number") return;
        setCommandOutputFilter("");
        setCommandResult({ command, container: containerName, result });
      },
      closeOnSuccess: true,
    });
  };

  const handleCreatePortForward = async () => {
    if (!name || offline || actionableContainers.length === 0) return;
    const remote = Number(portForwardRemotePort);
    if (!Number.isFinite(remote) || remote <= 0) {
      setPortForwardError("Remote port must be a positive number.");
      return;
    }
    let local: number | undefined;
    if (portForwardLocalPort.trim() !== "") {
      const lp = Number(portForwardLocalPort);
      if (!Number.isFinite(lp) || lp <= 0) {
        setPortForwardError("Local port must be a positive number.");
        return;
      }
      local = lp;
    }
    setPortForwardError("");
    try {
      setCreatingPortForward(true);
      const res = await createPortForwardSession(
        {
          namespace: ns,
          pod: name,
          remotePort: remote,
          localPort: local,
          title: `${name}:${remote}`,
        },
        props.token
      );
      setPortForwardCreatedMsg(`Port forward started: ${res.localHost}:${res.localPort} -> ${res.remotePort}`);
      emitFocusPortForwardsTab();
      setPortForwardDialogOpen(false);
    } catch (e) {
      setPortForwardError("Failed to create port-forward session.");
    } finally {
      setCreatingPortForward(false);
    }
  };

  // Load pod details when opened. Events are paged lazily by EventsPanel.
  useEffect(() => {
    if (!props.open || !name || offline) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setDetailSignals([]);
    setLogLines([]);
    setLogsFilter("");
    setPretty(false);
    setWrapLines(false);
    setExpandedContainers({});
    setEnvQueryByContainer({});
    setEnvShowRefsByContainer({});
    setEnvPrettyByContainer({});
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
    setDrawerSecret(null);
    setDrawerNamespace(null);
    stopLogs();

    setLoading(true);

    (async () => {
      const det = await apiGet<PodDetailsResponse>(
        `/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`,
        props.token
      );
      const item: PodDetails | null = det?.item ?? null;
      setDetails(item);
      setDetailSignals(Array.isArray(det?.detailSignals) ? det.detailSignals : []);

      // default container
      const containers = item?.containers || [];
      const containerNames = containers.map((c) => c.name).filter((n): n is string => !!n);
      const actionableContainerNames = containers
        .filter(isContainerActionAvailable)
        .map((c) => c.name)
        .filter((n): n is string => !!n);
      setContainer(containerNames[0] || "");
      setTerminalContainer(actionableContainerNames[0] || "");
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
      setEnvShowRefsByContainer({});
      setEnvPrettyByContainer({});
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, offline, stopLogs]);

  // Snapshot-level per-resource signals from the dataplane cache
  // (pod_restarts, pod_oomkilled, etc.). Detail-level signals
  // (pod_young_frequent_restarts, pod_succeeded_with_issues) arrive
  // through the details response as `detailSignals`; both are merged
  // into AttentionSummary below.
  const snapshotSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "pods",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  useEffect(() => {
    if (!props.open || !name || tab !== 3 || offline) return;
    if (networkingServicesLoading || networkingServicesLoaded) return;

    setNetworkingServicesLoading(true);
    setNetworkingServicesErr(null);

    apiGet<ApiListResponse<PodNetworkingService>>(`/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}/services`, props.token)
      .then((res) => {
        const items: PodNetworkingService[] = res?.items || [];
        setNetworkingServices(items);
      })
      .catch((e) => setNetworkingServicesErr(toApiError(e)))
      .finally(() => {
        setNetworkingServicesLoading(false);
        setNetworkingServicesLoaded(true);
      });
  }, [props.open, name, ns, props.token, tab, networkingServicesLoading, networkingServicesLoaded, offline]);

  useEffect(() => {
    if (!props.open || !name || tab !== 3 || offline) return;
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
          apiGet<ApiListResponse<PodNetworkingIngress>>(
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
    offline,
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
  const knownPodPortOptions = useMemo<PortForwardOption[]>(() => {
    const opts: PortForwardOption[] = [];
    const seen = new Set<string>();
    actionableContainers.forEach((ctn) => {
      (ctn.ports || []).forEach((p) => {
        const port = Number(p.containerPort || 0);
        if (!Number.isFinite(port) || port <= 0) return;
        const proto = p.protocol || "TCP";
        const key = `${port}/${proto}`;
        if (seen.has(key)) return;
        seen.add(key);
        const left = `${port}${p.name ? ` (${p.name})` : ""}`;
        opts.push({
          value: String(port),
          label: `${left} / ${proto} / ${ctn.name}`,
        });
      });
    });
    return opts.sort((a, b) => Number(a.value) - Number(b.value));
  }, [actionableContainers]);

  const handleOpenPortForwardDialog = useCallback(() => {
    if (offline || actionableContainers.length === 0) return;
    setPortForwardError("");
    if (knownPodPortOptions.length > 0) {
      setPortForwardRemotePort(knownPodPortOptions[0].value);
    } else {
      setPortForwardRemotePort("");
    }
    setPortForwardLocalPort("");
    setPortForwardDialogOpen(true);
  }, [actionableContainers.length, knownPodPortOptions, offline]);

  useEffect(() => registerContextActions([
    {
      id: "pod.logs",
      label: "Open logs and follow",
      binding: ["l"],
      disabled: !name,
      run: () => {
        if (!name) return false;
        setTab(5);
        window.setTimeout(() => startLogsFollow(), 0);
        return true;
      },
    },
    {
      id: "pod.portForward",
      label: "Open port-forward dialog",
      binding: ["p"],
      disabled: offline || creatingPortForward || actionableContainers.length === 0,
      run: () => {
        handleOpenPortForwardDialog();
        return true;
      },
    },
    {
      id: "drawer.close",
      label: "Close drawer",
      binding: ["escape"],
      run: () => {
        props.onClose();
        return true;
      },
    },
    {
      id: "drawer.yaml",
      label: "Open YAML tab",
      binding: ["y"],
      run: () => {
        setTab(7);
        return true;
      },
    },
  ]), [actionableContainers.length, creatingPortForward, handleOpenPortForwardDialog, name, offline, props, registerContextActions, startLogsFollow]);

  const eventContainers = (details?.containers || []).map((c) => c.name).filter((n): n is string => !!n);
  const openContainerFromEvent = (containerName: string) => {
    if (!eventContainers.includes(containerName)) return;
    setTab(1);
    setExpandedContainers((prev) => ({ ...prev, [containerName]: true }));
    window.requestAnimationFrame(() => {
      containerRefs.current[containerName]?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  // Merge detail-level signals (served inline with the pod details response,
  // e.g. pod_young_frequent_restarts, pod_succeeded_with_issues) with
  // snapshot-level signals from the per-resource signals endpoint
  // (pod_restarts, …). AttentionSummary de-duplicates nothing — detail and
  // snapshot signals are disjoint by construction so concatenation is safe.
  const podSignals = useMemo<DashboardSignalItem[]>(
    () => [...detailSignals, ...(snapshotSignals.signals || [])],
    [detailSignals, snapshotSignals.signals],
  );
  const missingSecretSignalsByName = useMemo(() => {
    const out = new Map<string, DashboardSignalItem>();
    podSignals
      .filter((signal) => signal.signalType === "pod_missing_secret_reference")
      .forEach((signal) => {
        (signal.actualData || "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((secretName) => out.set(secretName, signal));
      });
    return out;
  }, [podSignals]);

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
          <StatusChip label={summary.phase} color={phaseChipColor(summary.phase)} />
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
          <ResourceLinkChip label={summary.node} onClick={() => setDrawerNode(summary.node ?? null)} />
        ) : (
          "-"
        ),
      },
      { label: "Pod IP", value: valueOrDash(summary?.podIP) },
      { label: "Host IP", value: valueOrDash(summary?.hostIP) },
      { label: "QoS Class", value: valueOrDash(summary?.qosClass) },
      { label: "Start Time", value: summary?.startTime ? fmtTimeAgo(summary.startTime) : "-" },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      {
        label: "Controller",
        value:
          summary?.controllerKind && summary?.controllerName ? (
            <ResourceLinkChip
              label={`${summary.controllerKind}/${summary.controllerName}`}
              onClick={
                ["ReplicaSet", "Deployment", "StatefulSet", "DaemonSet", "Job"].includes(summary.controllerKind)
                  ? () => openController(summary.controllerKind!, summary.controllerName!)
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
            onClick={() => setDrawerServiceAccount(summary.serviceAccount ?? "")}
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
  const commandMenuItems = commandMenuContainer
    ? commandContainers.includes(commandMenuContainer)
      ? (matchingCommandsByContainer[commandMenuContainer] || []).map((command) => ({
          containerName: commandMenuContainer,
          command,
        }))
      : []
    : overviewCommandItems;
  const selectedCommand = commandResult?.command;
  const selectedResult = commandResult?.result;
  const commandOutput = selectedResult?.stdout || "";
  const normalizedCommandFilter = commandOutputFilter.trim().toLowerCase();
  const filteredCommandOutput = normalizedCommandFilter
    ? commandOutput
        .split(/\r?\n/)
        .filter((line) => line.toLowerCase().includes(normalizedCommandFilter))
        .join("\n")
    : commandOutput;
  const renderCommandOutput = () => {
    if (!selectedCommand || !selectedResult) return null;
    if (selectedCommand.outputType === "file") {
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Output is ready to download{selectedResult.compressed ? " as a gzip file" : ""}.
          </Typography>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={() => downloadCommandOutput(selectedResult, selectedCommand.fileName || selectedCommand.name)}
          >
            Download output
          </Button>
        </Box>
      );
    }
    if (selectedCommand.outputType === "keyValue") {
      const parsed = parseKeyValueOutput(commandOutput);
      if (!parsed.parseable) {
        return (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Alert severity="info">
              Output did not look like key-value data, so it is shown as free text.
            </Alert>
            {normalizedCommandFilter && !filteredCommandOutput ? (
              <EmptyState message="No output lines match the filter." />
            ) : (
              <CodeBlock code={filteredCommandOutput} language="text" />
            )}
          </Box>
        );
      }
      const rows = parsed.rows.filter((row) => {
        if (!normalizedCommandFilter) return true;
        return (
          row.key.toLowerCase().includes(normalizedCommandFilter) ||
          row.value.toLowerCase().includes(normalizedCommandFilter)
        );
      });
      if (rows.length === 0) {
        return (
          <EmptyState
            message={parsed.rows.length === 0 ? "Command produced no stdout." : "No output rows match the filter."}
          />
        );
      }
      return (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Key</TableCell>
              <TableCell>Value</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={`${row.key}-${idx}`}>
                <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{row.key}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", wordBreak: "break-word" }}>{row.value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    if (selectedCommand.outputType === "csv") {
      const parsed = parseDelimitedOutput(commandOutput);
      if (!parsed.parseable) {
        return (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Alert severity="info">
              Output did not look like delimited table data, so it is shown as free text.
            </Alert>
            {normalizedCommandFilter && !filteredCommandOutput ? (
              <EmptyState message="No output lines match the filter." />
            ) : (
              <CodeBlock code={filteredCommandOutput} language="text" />
            )}
          </Box>
        );
      }
      const rows = parsed.rows.filter((row) => {
        if (!normalizedCommandFilter) return true;
        return row.some((cell) => cell.toLowerCase().includes(normalizedCommandFilter));
      });
      if (rows.length === 0) return <EmptyState message="No table rows match the filter." />;
      const [header, ...bodyRows] = rows;
      return (
        <Box sx={{ overflow: "auto" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Detected delimiter: {parsed.delimiter === "\t" ? "tab" : parsed.delimiter}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                {header.map((cell, idx) => (
                  <TableCell key={`${cell}-${idx}`} sx={{ fontFamily: "monospace" }}>
                    {cell || `Column ${idx + 1}`}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {bodyRows.map((row, rowIdx) => (
                <TableRow key={`row-${rowIdx}`}>
                  {header.map((_, cellIdx) => (
                    <TableCell key={`cell-${rowIdx}-${cellIdx}`} sx={{ fontFamily: "monospace", wordBreak: "break-word" }}>
                      {row[cellIdx] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      );
    }
    if (selectedCommand.outputType === "code") {
      if (normalizedCommandFilter && !filteredCommandOutput) return <EmptyState message="No output lines match the filter." />;
      return <CodeBlock code={filteredCommandOutput} language={selectedCommand.codeLanguage || detectCodeLanguage(commandOutput)} />;
    }
    if (normalizedCommandFilter && !filteredCommandOutput) return <EmptyState message="No output lines match the filter." />;
    return <CodeBlock code={filteredCommandOutput} language="text" />;
  };

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="pods"
        title={
          <>
            Pod: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
          </>
        }
        onClose={props.onClose}
      >
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="Containers" />} iconPosition="start" label="Containers" />
              <Tab icon={<DetailTabIcon label="Resources" />} iconPosition="start" label="Resources" />
              <Tab icon={<DetailTabIcon label="Networking" />} iconPosition="start" label="Networking" />
              <Tab icon={<DetailTabIcon label="Events" />} iconPosition="start" label="Events" />
              <Tab icon={<DetailTabIcon label="Logs" />} iconPosition="start" label="Logs" />
              <Tab icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>
            <Box sx={{ ...drawerBodySx, mt: 3 }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <DrawerActionStrip>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<TerminalIcon />}
                        disabled={offline || creatingTerminal || actionableContainers.length === 0}
                        onClick={(e) => {
                          if (!details) return;
                          setTerminalMenuAnchor(e.currentTarget);
                        }}
                      >
                        Terminal
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CableIcon />}
                        disabled={offline || creatingPortForward || actionableContainers.length === 0}
                        onClick={handleOpenPortForwardDialog}
                      >
                        Port forward
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<PlayCircleOutlineIcon />}
                        disabled={offline || runningCommand || overviewCommandItems.length === 0}
                        onClick={(e) => {
                          setCommandMenuContainer("");
                          setCommandMenuAnchor(e.currentTarget);
                        }}
                      >
                        Commands
                      </Button>
                      <PodActions
                        token={props.token}
                        namespace={ns}
                        podName={name}
                        onDeleted={props.onClose}
                      />
                      <Menu
                        anchorEl={terminalMenuAnchor}
                        open={!!terminalMenuAnchor}
                        onClose={() => setTerminalMenuAnchor(null)}
                        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                        transformOrigin={{ vertical: "top", horizontal: "left" }}
                      >
                        {actionableContainers
                          .map((c) => c.name)
                          .filter((n): n is string => !!n)
                          .map((containerName) => (
                            <MenuItem
                              key={containerName}
                              disabled={offline || creatingTerminal}
                              onClick={() => {
                                setTerminalMenuAnchor(null);
                                void openTerminalForContainer(containerName);
                              }}
                            >
                              {containerName}
                            </MenuItem>
                          ))}
                      </Menu>
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={podSignals}
                    onJumpToEvents={() => setTab(4)}
                  />

                  <HealthConditionsPanel conditions={details?.conditions || []} />

                  <Section title="Lifecycle & Scheduling" dividerPlacement="content">
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
                              <KeyValueChip key={k} chipKey={k} value={v} />
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
                    </Section>
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
                      const showRefs = envShowRefsByContainer[containerKey] || false;
                      const prettyEnv = envPrettyByContainer[containerKey] || false;
                      const envFiltered = (ctn.env || []).filter((e) =>
                        String(e.name ?? "").toLowerCase().includes(envQuery.toLowerCase())
                      );

                      return (
                        <Box
                          key={containerKey}
                          ref={(node: HTMLDivElement | null) => {
                            containerRefs.current[containerKey] = node;
                          }}
                          sx={{
                            ...panelBoxSx,
                            border: unhealthy ? "1px solid var(--chip-error-border)" : "1px solid var(--panel-border)",
                          }}
                        >
                          <Box sx={{ pb: 1 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", minWidth: 0, flex: "1 1 auto" }}>
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
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", ml: "auto" }}>
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<TerminalIcon />}
                                  disabled={offline || creatingTerminal || !ctn.name || !isContainerActionAvailable(ctn)}
                                  onClick={() => {
                                    if (!ctn.name) return;
                                    void openTerminalForContainer(ctn.name);
                                  }}
                                >
                                  Terminal
                                </Button>
                                <Button
                                  variant="outlined"
                                  size="small"
                                  startIcon={<PlayCircleOutlineIcon />}
                                  disabled={
                                    offline ||
                                    runningCommand ||
                                    !ctn.name ||
                                    !isContainerActionAvailable(ctn) ||
                                    (matchingCommandsByContainer[ctn.name] || []).length === 0
                                  }
                                  onClick={(e) => {
                                    if (!ctn.name) return;
                                    setCommandMenuContainer(ctn.name);
                                    setCommandMenuAnchor(e.currentTarget);
                                  }}
                                >
                                  Commands
                                </Button>
                              </Box>
                            </Box>
                          </Box>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              <Section title="Runtime" dividerPlacement="content" variant="plain">
                                <KeyValueTable
                                  columns={3}
                                  sx={{ mt: 1 }}
                                  rows={[
                                    {
                                      label: "Image",
                                      value: <ContainerImageLabel image={ctn.image} imageId={ctn.imageId} />,
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
                                    { label: "Started At", value: ctn.startedAt ? fmtTimeAgo(ctn.startedAt) : "-" },
                                    { label: "Finished At", value: ctn.finishedAt ? fmtTimeAgo(ctn.finishedAt) : "-" },
                                    { label: "Last Termination Reason", value: valueOrDash(ctn.lastTerminationReason) },
                                    {
                                      label: "Last Termination Message",
                                      value: (
                                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                                          {valueOrDash(ctn.lastTerminationMessage)}
                                        </Typography>
                                      ),
                                    },
                                    { label: "Last Termination At", value: ctn.lastTerminationAt ? fmtTimeAgo(ctn.lastTerminationAt) : "-" },
                                  ]}
                                />
                              </Section>

                              <Section title="Resources" dividerPlacement="content" variant="plain">
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

                              {metricsUsable && ctn.usage ? (
                                <Section title="Usage" dividerPlacement="content" variant="plain">
                                  {(() => {
                                    const u = ctn.usage!;
                                    const cpuPct = u.cpuPctLimit ?? u.cpuPctRequest;
                                    const memPct = u.memoryPctLimit ?? u.memoryPctRequest;
                                    const cpuAnchor = u.cpuPctLimit != null ? "limit" : u.cpuPctRequest != null ? "request" : "";
                                    const memAnchor = u.memoryPctLimit != null ? "limit" : u.memoryPctRequest != null ? "request" : "";
                                    return (
                                      <Box sx={{ mt: 1 }}>
                                        <GaugeTableRow
                                          label="CPU"
                                          hint={cpuAnchor ? `Percentage of ${cpuAnchor}; sourced from metrics.k8s.io.` : "Live usage from metrics.k8s.io."}
                                          bar={
                                            cpuPct != null && cpuPct > 0 ? (
                                              <GaugeBar value={cpuPct} tone={usageGaugeTone(cpuPct)} label={formatPct(cpuPct)} />
                                            ) : (
                                              <Box sx={{ fontSize: 12, color: "text.secondary" }}>No request/limit set</Box>
                                            )
                                          }
                                          summary={formatCPUMilli(u.cpuMilli)}
                                        />
                                        <GaugeTableRow
                                          label="Memory"
                                          hint={memAnchor ? `Percentage of ${memAnchor}; sourced from metrics.k8s.io.` : "Live usage from metrics.k8s.io."}
                                          bar={
                                            memPct != null && memPct > 0 ? (
                                              <GaugeBar value={memPct} tone={usageGaugeTone(memPct)} label={formatPct(memPct)} />
                                            ) : (
                                              <Box sx={{ fontSize: 12, color: "text.secondary" }}>No request/limit set</Box>
                                            )
                                          }
                                          summary={formatMemoryBytes(u.memoryBytes)}
                                        />
                                      </Box>
                                    );
                                  })()}
                                </Section>
                              ) : null}

                              <Accordion>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                                    <Typography variant="subtitle2">Environment</Typography>
                                    <Chip size="small" label={(ctn.env || []).length} />
                                  </Box>
                                </AccordionSummary>
                                <AccordionDetails>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
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
                                        checked={showRefs}
                                        inputProps={{ "aria-label": "Show environment source references" }}
                                        onChange={(e) =>
                                          setEnvShowRefsByContainer((prev) => ({
                                            ...prev,
                                            [containerKey]: e.target.checked,
                                          }))
                                        }
                                      />
                                    }
                                    label={
                                      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                        <span>Show references</span>
                                        <InfoHint title="Shows the exact env source reference, such as config-map:key, secret:key, metadata.name, or a resource field. This does not resolve ConfigMap or Secret contents; literal values are always shown." />
                                      </Box>
                                    }
                                  />
                                  <FormControlLabel
                                    control={
                                      <Switch
                                        checked={prettyEnv}
                                        inputProps={{ "aria-label": "Pretty environment values" }}
                                        onChange={(e) =>
                                          setEnvPrettyByContainer((prev) => ({
                                            ...prev,
                                            [containerKey]: e.target.checked,
                                          }))
                                        }
                                      />
                                    }
                                    label={
                                      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                        <span>Pretty</span>
                                        <InfoHint title="Decorates exact boolean-like values, debug and log-level strings with themed chips, and turns http:// or https:// values into clickable links. Plain mode preserves text-only rendering." />
                                      </Box>
                                    }
                                  />
                                </Box>
                                {(ctn.env || []).length === 0 ? (
                                  <EmptyState message="No environment variables." sx={{ mt: 1 }} />
                                ) : envFiltered.length === 0 ? (
                                  <EmptyState message="No environment variables match the filter." sx={{ mt: 1 }} />
                                ) : (
                                  <Table size="small" sx={{ mt: 1 }}>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Name</TableCell>
                                        <TableCell>{showRefs ? "Value / Reference" : "Value"}</TableCell>
                                        <TableCell>Source</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {envFiltered.map((e, envIdx) => (
                                        <TableRow key={`${containerKey}-env-${e.name ?? envIdx}`}>
                                          <TableCell>{valueOrDash(e.name)}</TableCell>
                                          <TableCell>
                                            <EnvValueDisplay
                                              value={e.source === "Value" ? e.value : showRefs ? e.sourceRef : undefined}
                                              pretty={prettyEnv}
                                            />
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
                                </AccordionDetails>
                              </Accordion>

                              <Accordion>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                                    <Typography variant="subtitle2">Mounts & Volumes</Typography>
                                    <Chip size="small" label={(ctn.mounts || []).length} />
                                  </Box>
                                </AccordionSummary>
                                <AccordionDetails>
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
                                </AccordionDetails>
                              </Accordion>

                              <Accordion>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                                    <Typography variant="subtitle2">Probes</Typography>
                                    <Chip
                                      size="small"
                                      label={
                                        [
                                          ctn.probes?.liveness,
                                          ctn.probes?.readiness,
                                          ctn.probes?.startup,
                                        ].filter(Boolean).length
                                      }
                                    />
                                  </Box>
                                </AccordionSummary>
                                <AccordionDetails>
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
                                </AccordionDetails>
                              </Accordion>
                            </Box>
                        </Box>
                      );
                    })
                  )}
                </Box>
              )}

              {/* RESOURCES */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
                  <Section title="Volumes" dividerPlacement="content">
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
                            {(details?.resources?.volumes || []).map((v, idx) => {
                              const secretSignal = v.source ? missingSecretSignalsByName.get(v.source) : undefined;
                              return (
                                <TableRow key={v.name || String(idx)}>
                                  <TableCell>{valueOrDash(v.name)}</TableCell>
                                  <TableCell>{valueOrDash(v.type)}</TableCell>
                                  <TableCell>
                                    {String(v.type || "").toLowerCase() === "secret" && v.source ? (
                                      <ResourceLinkChip
                                        label={v.source}
                                        onClick={() => setDrawerSecret(v.source || null)}
                                        color={secretSignal ? "warning" : undefined}
                                        title={secretSignal?.reason || secretSignal?.calculatedData || `Secret ${v.source}`}
                                      />
                                    ) : (
                                      valueOrDash(v.source)
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </Section>

                  <Section title="Image Pull Secrets" dividerPlacement="content">
                      {(details?.resources?.imagePullSecrets || []).length === 0 ? (
                        <EmptyState message="No image pull secrets." />
                      ) : (
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                          {(details?.resources?.imagePullSecrets || [])
                            .filter((s): s is string => !!s)
                            .map((s) => {
                              const secretSignal = missingSecretSignalsByName.get(s);
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
                    </Section>

                  <Section title="Security Context" dividerPlacement="content">
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
                                  <TableCell>{valueOrDash(c.privileged != null ? String(c.privileged) : undefined)}</TableCell>
                                  <TableCell>{valueOrDash(c.readOnlyRootFilesystem != null ? String(c.readOnlyRootFilesystem) : undefined)}</TableCell>
                                  <TableCell>{valueOrDash(c.allowPrivilegeEscalation != null ? String(c.allowPrivilegeEscalation) : undefined)}</TableCell>
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
                    </Section>

                  <Section title="DNS & Host Aliases" dividerPlacement="content">
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
                    </Section>

                  <Section title="Topology Spread Constraints" dividerPlacement="content">
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
                    </Section>
                </Box>
              )}

              {/* NETWORKING */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
                  <Section title="Services" dividerPlacement="content">
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
                                          <KeyValueChip chipKey={k} value={v} />
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
                    </Section>

                  <Section title="Ingresses" dividerPlacement="content">
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
                    </Section>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 4 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto", pt: 1 }}>
                  <EventsPanel
                    endpoint={`/api/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name || "")}/events`}
                    token={props.token}
                    emptyMessage="No events found for this Pod."
                    filterPlaceholder="Filter events"
                    subResourceLabel="Container"
                    subResourceOptions={eventContainers.map((name) => ({ label: name, value: name }))}
                    getEventSubResource={(event) => parseContainerFromFieldPath(event.fieldPath)}
                    onSubResourceClick={openContainerFromEvent}
                  />
                </Box>
              )}

              {/* LOGS */}
              {tab === 5 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", pt: 1 }}>
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

              {/* METADATA */}
              {tab === 6 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                  <MetadataSection
                    labels={details?.metadata?.labels}
                    annotations={details?.metadata?.annotations}
                  />
                </Box>
              )}

              {/* YAML */}
              {tab === 7 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Pod",
                    group: "",
                    resource: "pods",
                    apiVersion: "v1",
                    namespace: ns,
                    name: name || "",
                  }}
                />
              )}
      </Box>
      <PortForwardDialog
        open={portForwardDialogOpen}
        busy={creatingPortForward}
        targetLabel={`Target Pod: ${ns}/${name}`}
        remotePort={portForwardRemotePort}
        localPort={portForwardLocalPort}
        error={portForwardError}
        disabled={offline}
        disabledReason={offlineReason}
        remotePortOptions={knownPodPortOptions}
        onChangeRemotePort={setPortForwardRemotePort}
        onChangeLocalPort={setPortForwardLocalPort}
        onClose={() => setPortForwardDialogOpen(false)}
        onSubmit={() => {
          void handleCreatePortForward();
        }}
      />
      <PortForwardCreatedSnackbar
        open={!!portForwardCreatedMsg}
        message={portForwardCreatedMsg}
        onClose={() => setPortForwardCreatedMsg("")}
      />
      <Menu
        anchorEl={commandMenuAnchor}
        open={!!commandMenuAnchor}
        onClose={() => {
          setCommandMenuAnchor(null);
          setCommandMenuContainer("");
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {commandMenuItems.map(({ containerName, command }) => (
          <MenuItem
            key={`${containerName}-${command.id}`}
            disabled={offline || runningCommand}
            onClick={() => {
              setCommandMenuAnchor(null);
              setCommandMenuContainer("");
              void runConfiguredCommand(containerName, command);
            }}
          >
            {commandMenuContainer ? command.name || command.command : `${containerName}: ${command.name || command.command}`}
          </MenuItem>
        ))}
      </Menu>
      <Dialog open={!!commandResult} onClose={() => setCommandResult(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
          <Box sx={{ flexGrow: 1 }}>{selectedCommand?.name || "Command output"}</Box>
          <Tooltip title="Close">
            <IconButton aria-label="Close command output" size="small" onClick={() => setCommandResult(null)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, minHeight: 260 }}>
          {commandResult ? (
            <KeyValueTable
              columns={3}
              rows={[
                { label: "Container", value: commandResult.container },
                { label: "Exit code", value: selectedResult?.exitCode ?? "-" },
                { label: "Duration", value: selectedResult ? `${selectedResult.durationMs} ms` : "-" },
              ]}
            />
          ) : null}
          {selectedResult?.error || selectedResult?.stderr ? (
            <Alert severity={selectedResult.exitCode === 0 ? "warning" : "error"}>
              {selectedResult.error ? <Typography variant="body2">{selectedResult.error}</Typography> : null}
              {selectedResult.stderr ? (
                <Box sx={{ mt: selectedResult.error ? 1 : 0 }}>
                  <CodeBlock code={selectedResult.stderr} language="text" showCopy={false} />
                </Box>
              ) : null}
            </Alert>
          ) : null}
          {selectedCommand && selectedCommand.outputType !== "file" ? (
            <TextField
              size="small"
              label="Filter output"
              value={commandOutputFilter}
              onChange={(e) => setCommandOutputFilter(e.target.value)}
              placeholder={
                selectedCommand.outputType === "keyValue"
                  ? "Filter by key or value"
                  : selectedCommand.outputType === "csv"
                    ? "Filter table rows"
                  : "Filter output lines"
              }
              fullWidth
            />
          ) : null}
          <Box sx={{ flex: 1, minHeight: 0 }}>{renderCommandOutput()}</Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommandResult(null)}>Close</Button>
        </DialogActions>
      </Dialog>
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
            <SecretDrawer
              open={!!drawerSecret}
              onClose={() => setDrawerSecret(null)}
              token={props.token}
              namespace={ns}
              secretName={drawerSecret}
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
