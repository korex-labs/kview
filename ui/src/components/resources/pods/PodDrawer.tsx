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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Menu,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CableIcon from "@mui/icons-material/Cable";
import DownloadIcon from "@mui/icons-material/Download";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlineOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import { apiGet, toApiError, type ApiError } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { fmtAge, fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { phaseChipColor } from "../../../utils/k8sUi";
import HealthConditionsPanel from "../../shared/HealthConditionsPanel";
import { AppButton, AppIconButton, DialogActionButton } from "../../shared/AppActions";
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
import PodDebugDialog from "./PodDebugDialog";
import PodContainersTab, { isContainerActionAvailable, isContainerHealthy } from "./PodContainersTab";
import EnvValueDisplay from "./EnvValueDisplay";
import type { ContainerSecurity, PodContainer, PodEphemeralContainer } from "./podDetailsTypes";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import { ResourceDrawerTags } from "../../shared/ResourceTags";
import { ResourceDrawerMacros } from "../../shared/ResourceMacros";
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
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import InfoHint from "../../shared/InfoHint";
import StatusChip from "../../shared/StatusChip";
import EventsPanel from "../../shared/EventsPanel";
import { useMetricsStatus, isMetricsUsable } from "../../metrics/useMetricsStatus";
import PortForwardDialog, { type PortForwardOption } from "../../shared/PortForwardDialog";
import PortForwardCreatedSnackbar from "../../shared/PortForwardCreatedSnackbar";
import { createTerminalSession, createPortForwardSession, runContainerCommand, type RunContainerCommandResult } from "../../../sessionsApi";
import { emitFocusPortForwardsTab, emitOpenTerminalSession } from "../../../activityEvents";
import { useActiveContext } from "../../../activeContext";
import { useUserSettings } from "../../../settingsContext";
import { useContextualKeyboardActions } from "../../../keyboard/KeyboardProvider";
import { customCommandsForContainer, type CustomCommandDefinition } from "../../../settings";
import { useMutationDialog } from "../../mutations/useMutationDialog";
import type { ExecuteActionResult } from "../../../lib/actions/types";
import {
  buildCustomCommandContextualActions,
  customCommandTargets,
  resolveCustomCommandChooserTarget,
  type CustomCommandChooserRequest,
} from "./contextualCustomCommands";
import { buildPodKeyboardActions } from "./podKeyboardActions";

type PodDetails = {
  summary: PodSummary;
  conditions: PodCondition[];
  lifecycle: PodLifecycle;
  containers: PodContainer[];
  ephemeralContainers?: PodEphemeralContainer[];
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
  uid: string;
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

type LogStreamNotice = {
  severity: "info" | "warning" | "error";
  message: string;
};

type LogStreamControlMessage = {
  __kviewLogStream?: boolean;
  type?: string;
  message?: string;
};

// WebSocket URLs use query token: browser WebSocket API cannot set Authorization header.
function wsURL(path: string, token: string) {
  const u = new URL(window.location.href);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  const sep = path.includes("?") ? "&" : "?";
  return `${proto}//${u.host}${path}${sep}token=${encodeURIComponent(token)}`;
}

function parseLogStreamControlMessage(raw: string): LogStreamControlMessage | null {
  const s = raw.trim();
  if (!s.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(s) as LogStreamControlMessage;
    if (parsed && parsed.__kviewLogStream === true && typeof parsed.type === "string") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
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

function parseContainerFromFieldPath(path?: string) {
  if (!path) return "";
  const match = path.match(/spec\.(?:initContainers|containers|ephemeralContainers)\{(.+)\}/);
  return match ? match[1] : "";
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
  const { open: openMutationDialog } = useMutationDialog();
  const offline = health === "unhealthy";
  const offlineReason = "Cluster connection is unavailable";
  const metricsStatus = useMetricsStatus(props.token);
  const metricsUsable = isMetricsUsable(metricsStatus);
  const [tab, setTab] = useState(0);
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
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
  const [logStreamNotice, setLogStreamNotice] = useState<LogStreamNotice | null>(null);

  // Store log entries as array for filtering + pretty formatting
  const [logLines, setLogLines] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logStopRequestedRef = useRef(false);
  const logStreamHadErrorRef = useRef(false);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const ns = props.namespace;
  const name = props.podName;
  const [creatingTerminal, setCreatingTerminal] = useState(false);
  const [podDebugDialogOpen, setPodDebugDialogOpen] = useState(false);
  const [creatingPortForward, setCreatingPortForward] = useState(false);
  const [terminalContainer, setTerminalContainer] = useState<string>("");
  const [terminalMenuAnchor, setTerminalMenuAnchor] = useState<null | HTMLElement>(null);
  const [commandMenuAnchor, setCommandMenuAnchor] = useState<null | HTMLElement>(null);
  const [commandMenuContainer, setCommandMenuContainer] = useState<string>("");
  const [commandTargetChooserRequest, setCommandTargetChooserRequest] = useState<CustomCommandChooserRequest | null>(null);
  const [runningCommand, setRunningCommand] = useState(false);
  const [commandResult, setCommandResult] = useState<{
    command: CustomCommandDefinition;
    container: string;
    result: RunContainerCommandResult;
  } | null>(null);
  const [commandOutputFilter, setCommandOutputFilter] = useState("");
  const [commandKeyValuePretty, setCommandKeyValuePretty] = useState(true);
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
  const contextualCommandTargets = useMemo(
    () => customCommandTargets(settings.customCommands.commands, commandContainers),
    [commandContainers, settings.customCommands.commands],
  );
  const commandTargetChooser = useMemo(
    () => resolveCustomCommandChooserTarget(
      commandTargetChooserRequest,
      activeContext || "",
      ns,
      name || "",
      contextualCommandTargets,
    ),
    [activeContext, commandTargetChooserRequest, contextualCommandTargets, name, ns],
  );

  useEffect(() => {
    setCommandTargetChooserRequest(null);
  }, [activeContext, name, ns]);

  const stopLogs = useCallback(() => {
    setFollowing(false);
    logStopRequestedRef.current = true;
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
    setLogStreamNotice(null);
    logStopRequestedRef.current = false;
    logStreamHadErrorRef.current = false;

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
      if (wsRef.current !== ws) return;
      const chunk = String(ev.data ?? "");
      const control = parseLogStreamControlMessage(chunk);
      if (control) {
        if (control.type === "error") {
          const message = control.message || "Log stream failed.";
          logStreamHadErrorRef.current = true;
          setLogStreamNotice({
            severity: "error",
            message: `Log stream failed: ${message}`,
          });
          setFollowing(false);
        }
        return;
      }
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
      if (wsRef.current !== ws) return;
      logStreamHadErrorRef.current = true;
      setLogStreamNotice({
        severity: "error",
        message: "Log stream connection failed. The browser could not keep the WebSocket open.",
      });
      setFollowing(false);
    };

    ws.onclose = (ev) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setFollowing(false);
      if (logStopRequestedRef.current) {
        logStopRequestedRef.current = false;
        return;
      }
      if (logStreamHadErrorRef.current) return;
      if (!ev.wasClean) {
        setLogStreamNotice({
          severity: "warning",
          message: "Log stream closed unexpectedly. Start follow again to reconnect.",
        });
        return;
      }
      setLogStreamNotice({
        severity: "info",
        message: "Log stream ended.",
      });
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

  const runConfiguredCommand = useCallback((containerName: string, command: CustomCommandDefinition) => {
    const target = (details?.containers || []).find((ctn) => ctn.name === containerName);
    if (!name || !containerName || offline || runningCommand || !isContainerActionAvailable(target)) return false;
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
    return true;
  }, [activeContext, details?.containers, name, ns, offline, openMutationDialog, props.token, runningCommand]);

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
  }, [props.open, name, ns, props.token, retryNonce, detailRefreshNonce, offline, stopLogs]);

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

  const customCommandKeyboardActions = useMemo(
    () => buildCustomCommandContextualActions({
      targets: contextualCommandTargets,
      overrides: settings.keyboard.overrides,
      disabled: offline || runningCommand || !name,
      runCommand: (containerName, command) => {
        runConfiguredCommand(containerName, command);
      },
      chooseContainer: (command) => setCommandTargetChooserRequest({
        commandId: command.id,
        context: activeContext || "",
        namespace: ns,
        podName: name || "",
      }),
    }),
    [
      activeContext,
      contextualCommandTargets,
      name,
      ns,
      offline,
      runConfiguredCommand,
      runningCommand,
      settings.keyboard.overrides,
    ],
  );

  const podKeyboardActions = useMemo(() => [
    ...buildPodKeyboardActions({
      logsDisabled: !name,
      portForwardDisabled: offline || creatingPortForward || actionableContainers.length === 0,
      openLogsAndFollow: () => {
        setTab(5);
        window.setTimeout(() => startLogsFollow(), 0);
      },
      openPortForward: handleOpenPortForwardDialog,
    }),
    ...customCommandKeyboardActions,
  ], [
    actionableContainers.length,
    creatingPortForward,
    customCommandKeyboardActions,
    handleOpenPortForwardDialog,
    name,
    offline,
    startLogsFollow,
  ]);
  useContextualKeyboardActions(podKeyboardActions);

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
          <AppButton
            intent="primary"
            startIcon={<DownloadIcon />}
            onClick={() => downloadCommandOutput(selectedResult, selectedCommand.fileName || selectedCommand.name)}
          >
            Download output
          </AppButton>
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
                <TableCell sx={{ wordBreak: "break-word" }}>
                  <EnvValueDisplay value={row.value} pretty={commandKeyValuePretty} />
                </TableCell>
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
      <ResourceDrawerShell
        token={props.token}
        resourceIcon="pods"
        title={
          <>
            Pod: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
          </>
        }
        headerMeta={<ResourceDrawerTags resource="pods" namespace={ns} name={name} labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} />}
        dynamicLinks={{
          resource: "pods",
          namespace: ns,
          name,
          nodeName: summary?.node,
          labels: details?.metadata?.labels,
          annotations: details?.metadata?.annotations,
        }}
        headerActions={
          <>
            <ResourceDrawerMacros
              resource="pods"
              namespace={ns}
              name={name}
              nodeName={summary?.node}
              labels={details?.metadata?.labels}
              annotations={details?.metadata?.annotations}
            />
            <ResourceDrawerTags resource="pods" namespace={ns} name={name} labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} mode="edit" />
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
              <Tab data-keyboard-action-id="drawer.tab.overview" icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab data-keyboard-action-id="drawer.tab.containers" icon={<DetailTabIcon label="Containers" />} iconPosition="start" label="Containers" />
              <Tab data-keyboard-action-id="drawer.tab.resources" icon={<DetailTabIcon label="Resources" />} iconPosition="start" label="Resources" />
              <Tab data-keyboard-action-id="drawer.tab.networking" icon={<DetailTabIcon label="Networking" />} iconPosition="start" label="Networking" />
              <Tab data-keyboard-action-id="drawer.tab.events" icon={<DetailTabIcon label="Events" />} iconPosition="start" label="Events" />
              <Tab data-keyboard-action-id="drawer.tab.logs" icon={<DetailTabIcon label="Logs" />} iconPosition="start" label="Logs" />
              <Tab data-keyboard-action-id="drawer.tab.metadata" icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab data-keyboard-action-id="drawer.tab.yaml" icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>
            <Box sx={{ ...drawerBodySx, mt: 3 }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <DrawerActionStrip>
                      <AppButton
                        startIcon={<TerminalIcon />}
                        disabled={offline || creatingTerminal || actionableContainers.length === 0}
                        onClick={(e) => {
                          if (!details) return;
                          setTerminalMenuAnchor(e.currentTarget);
                        }}
                      >
                        Terminal
                      </AppButton>
                      {settings.podDebug.enabled ? (
                        <AppButton
                          startIcon={<BugReportOutlinedIcon />}
                          tooltip={summary?.phase !== "Running" ? "Pod Debug requires a running Pod" : "Add an ephemeral debug container"}
                          disabled={offline || !activeContext || summary?.phase !== "Running" || !summary?.uid || actionableContainers.length === 0}
                          onClick={() => setPodDebugDialogOpen(true)}
                        >
                          Debug
                        </AppButton>
                      ) : null}
                      <AppButton
                        startIcon={<CableIcon />}
                        disabled={offline || creatingPortForward || actionableContainers.length === 0}
                        onClick={handleOpenPortForwardDialog}
                      >
                        Port forward
                      </AppButton>
                      <AppButton
                        startIcon={<PlayCircleOutlineIcon />}
                        disabled={offline || runningCommand || overviewCommandItems.length === 0}
                        onClick={(e) => {
                          setCommandMenuContainer("");
                          setCommandMenuAnchor(e.currentTarget);
                        }}
                      >
                        Commands
                      </AppButton>
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
                    token={props.token}
                    signals={podSignals}
                    suppressedSignalCount={snapshotSignals.suppressedSignalCount}
                    suppressedSignals={snapshotSignals.suppressedSignals}
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
                <PodContainersTab
                  containers={details?.containers || []}
                  ephemeralContainers={details?.ephemeralContainers || []}
                  qosClass={summary?.qosClass}
                  metricsUsable={metricsUsable}
                  offline={offline}
                  creatingTerminal={creatingTerminal}
                  runningCommand={runningCommand}
                  matchingCommandCounts={Object.fromEntries(
                    Object.entries(matchingCommandsByContainer).map(([containerName, commands]) => [containerName, commands.length]),
                  )}
                  envQueryByContainer={envQueryByContainer}
                  envShowRefsByContainer={envShowRefsByContainer}
                  envPrettyByContainer={envPrettyByContainer}
                  onContainerRef={(containerName, node) => {
                    containerRefs.current[containerName] = node;
                  }}
                  onOpenTerminal={(containerName) => {
                    void openTerminalForContainer(containerName);
                  }}
                  onOpenCommands={(containerName, anchor) => {
                    setCommandMenuContainer(containerName);
                    setCommandMenuAnchor(anchor);
                  }}
                  onEnvQueryChange={(containerName, value) => {
                    setEnvQueryByContainer((prev) => ({ ...prev, [containerName]: value }));
                  }}
                  onEnvShowRefsChange={(containerName, value) => {
                    setEnvShowRefsByContainer((prev) => ({ ...prev, [containerName]: value }));
                  }}
                  onEnvPrettyChange={(containerName, value) => {
                    setEnvPrettyByContainer((prev) => ({ ...prev, [containerName]: value }));
                  }}
                />
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

                  {logStreamNotice && (
                    <Alert severity={logStreamNotice.severity} variant="outlined" sx={{ alignItems: "center" }}>
                      {logStreamNotice.message}
                    </Alert>
                  )}

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
      <PodDebugDialog
        open={podDebugDialogOpen}
        token={props.token}
        contextName={activeContext}
        namespace={ns}
        pod={name || ""}
        podUID={details?.summary?.uid || ""}
        containers={(details?.containers || []).map((containerItem) => ({ name: containerItem.name, state: containerItem.state }))}
        defaultImage={settings.podDebug.defaultImage}
        defaultShell={settings.podDebug.defaultShell}
        onClose={() => setPodDebugDialogOpen(false)}
        onCreated={(sessionId, targetContainer) => {
          emitOpenTerminalSession({
            sessionId,
            source: "pod-debug",
            namespace: ns,
            pod: name || "",
            container: targetContainer,
          });
          setDetailRefreshNonce((value) => value + 1);
        }}
      />
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
      <Dialog
        open={!!commandTargetChooser}
        onClose={() => setCommandTargetChooserRequest(null)}
        aria-labelledby="custom-command-container-title"
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id="custom-command-container-title">
          Choose container for {commandTargetChooser?.command.name || "custom command"}
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {(commandTargetChooser?.containerNames || []).map((containerName) => (
              <AppButton
                key={containerName}
                disabled={offline || runningCommand}
                onClick={() => {
                  const target = commandTargetChooser;
                  setCommandTargetChooserRequest(null);
                  if (!target) return;
                  runConfiguredCommand(containerName, target.command);
                }}
                sx={{ justifyContent: "flex-start" }}
              >
                {containerName}
              </AppButton>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <DialogActionButton action="cancel" onClick={() => setCommandTargetChooserRequest(null)}>Cancel</DialogActionButton>
        </DialogActions>
      </Dialog>
      <Dialog open={!!commandResult} onClose={() => setCommandResult(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
          <Box sx={{ flexGrow: 1 }}>{selectedCommand?.name || "Command output"}</Box>
          <AppIconButton tooltip="Close" label="Close command output" onClick={() => setCommandResult(null)}>
            <CloseIcon fontSize="small" />
          </AppIconButton>
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
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
                sx={{ flex: "1 1 260px", minWidth: 220 }}
              />
              {selectedCommand.outputType === "keyValue" ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={commandKeyValuePretty}
                      slotProps={{ input: { "aria-label": "Pretty command key-value output" } }}
                      onChange={(e) => setCommandKeyValuePretty(e.target.checked)}
                    />
                  }
                  label={
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      <span>Pretty</span>
                      <InfoHint title="Decorates exact boolean-like values, debug and log-level strings with themed chips, and turns http:// or https:// values into clickable links. Plain mode preserves text-only rendering." />
                    </Box>
                  }
                />
              ) : null}
            </Box>
          ) : null}
          <Box sx={{ flex: 1, minHeight: 0 }}>{renderCommandOutput()}</Box>
        </DialogContent>
        <DialogActions>
          <DialogActionButton action="cancel" onClick={() => setCommandResult(null)}>Close</DialogActionButton>
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
