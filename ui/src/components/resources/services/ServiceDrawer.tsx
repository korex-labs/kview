import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Tooltip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
} from "@mui/material";
import CableIcon from "@mui/icons-material/Cable";
import { apiGet, toApiError, type ApiError } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import IngressDrawer from "../ingresses/IngressDrawer";
import PodDrawer from "../pods/PodDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import KeyValueTable from "../../shared/KeyValueTable";
import KeyValueChip from "../../shared/KeyValueChip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import AccessDeniedState from "../../shared/AccessDeniedState";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import MetadataSection from "../../shared/MetadataSection";
import AttentionSummary from "../../shared/AttentionSummary";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import CodeBlock from "../../shared/CodeBlock";
import ServiceActions from "./ServiceActions";
import { createPortForwardSession } from "../../../sessionsApi";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import type { ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  fetchNamespacedResourceDetailWithWarnings,
  type ResourceWarningEvent,
} from "../../../utils/resourceDrawerFetch";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";
import PortForwardDialog, { type PortForwardOption } from "../../shared/PortForwardDialog";
import PortForwardCreatedSnackbar from "../../shared/PortForwardCreatedSnackbar";
import { emitFocusPortForwardsTab } from "../../../activityEvents";

type ServiceDetails = {
  summary: ServiceSummary;
  ports: ServicePort[];
  traffic: ServiceTraffic;
  endpoints: ServiceEndpoints;
  yaml: string;
};

type ServiceSummary = {
  name: string;
  namespace: string;
  type: string;
  clusterIPs?: string[];
  externalName?: string;
  selector?: Record<string, string>;
  sessionAffinity?: string;
  ageSec?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type ServicePort = {
  name?: string;
  port: number;
  targetPort?: string;
  protocol?: string;
  nodePort?: number;
};

type ServiceTraffic = {
  externalTrafficPolicy?: string;
  loadBalancerIngress?: string[];
};

type ServiceEndpoints = {
  ready: number;
  notReady: number;
  pods?: ServiceEndpointPod[];
};

type ServiceEndpointPod = {
  name: string;
  namespace: string;
  node?: string;
  ready: boolean;
};

type ServiceIngress = {
  name: string;
  namespace: string;
  ingressClassName?: string;
  hosts?: string[];
  tlsCount?: number;
  addresses?: string[];
};

function formatClusterIPs(ips?: string[]) {
  if (!ips || ips.length === 0) return "-";
  return ips.join(", ");
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

function buildExternalUrls(
  summary?: ServiceSummary,
  traffic?: ServiceTraffic,
  ports?: ServicePort[],
): string[] {
  if (!summary) return [];
  const urls: string[] = [];

  if (summary.type === "LoadBalancer" && traffic?.loadBalancerIngress?.length) {
    for (const addr of traffic.loadBalancerIngress) {
      if (!addr) continue;
      const has443 = (ports || []).some((p) => p.port === 443);
      const has80 = (ports || []).some((p) => p.port === 80);
      if (has443) urls.push(`https://${addr}`);
      else if (has80) urls.push(`http://${addr}`);
      else {
        // Show first port
        const first = (ports || [])[0];
        if (first) urls.push(`http://${addr}:${first.port}`);
        else urls.push(`http://${addr}`);
      }
    }
  }

  if (summary.type === "ExternalName" && summary.externalName) {
    urls.push(`http://${summary.externalName}`);
  }

  return urls;
}

export default function ServiceDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  serviceName: string | null;
}) {
  const { health, retryNonce } = useConnectionState();
  const offline = health === "unhealthy";
  const offlineReason = "Cluster connection is unavailable";
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ServiceDetails | null>(null);
  const [events, setEvents] = useState<ResourceWarningEvent[]>([]);
  const [err, setErr] = useState("");
  const [drawerPod, setDrawerPod] = useState<string | null>(null);
  const [drawerPodNs, setDrawerPodNs] = useState<string>("");
  const [ingresses, setIngresses] = useState<ServiceIngress[]>([]);
  const [ingressesLoading, setIngressesLoading] = useState(false);
  const [ingressesLoaded, setIngressesLoaded] = useState(false);
  const [ingressesErr, setIngressesErr] = useState<ApiError | null>(null);
  const [drawerIngress, setDrawerIngress] = useState<{ name: string; namespace: string } | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const [creatingPortForward, setCreatingPortForward] = useState(false);
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false);
  const [portForwardRemotePort, setPortForwardRemotePort] = useState<string>("");
  const [portForwardLocalPort, setPortForwardLocalPort] = useState<string>("");
  const [portForwardError, setPortForwardError] = useState<string>("");
  const [portForwardCreatedMsg, setPortForwardCreatedMsg] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  const ns = props.namespace;
  const name = props.serviceName;

  useEffect(() => {
    if (!props.open || !name || offline) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPod(null);
    setDrawerPodNs("");
    setIngresses([]);
    setIngressesLoading(false);
    setIngressesLoaded(false);
    setIngressesErr(null);
    setDrawerIngress(null);
    setDrawerNamespace(null);
    setLoading(true);

    fetchNamespacedResourceDetailWithWarnings<ServiceDetails>({
      token: props.token,
      namespace: ns,
      resource: "services",
      name,
    })
      .then((res) => {
        setDetails(res.item);
        setEvents(res.warningEvents);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, offline, refreshNonce]);

  useEffect(() => {
    if (!props.open || !name || tab !== 1 || offline) return;
    if (ingressesLoading || ingressesLoaded) return;

    setIngressesLoading(true);
    setIngressesErr(null);

    apiGet<ApiListResponse<ServiceIngress>>(
      `/api/namespaces/${encodeURIComponent(ns)}/services/${encodeURIComponent(name)}/ingresses`,
      props.token
    )
      .then((res) => {
        const items: ServiceIngress[] = res?.items || [];
        setIngresses(items);
      })
      .catch((e) => setIngressesErr(toApiError(e)))
      .finally(() => {
        setIngressesLoading(false);
        setIngressesLoaded(true);
      });
  }, [props.open, name, ns, props.token, tab, ingressesLoading, ingressesLoaded, offline]);

  const summary = details?.summary;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "services",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const serviceSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  const knownServicePorts = useMemo(() => (details?.ports || []) as ServicePort[], [details]);
  const knownServicePortOptions = useMemo<PortForwardOption[]>(
    () =>
      knownServicePorts.map((p, idx) => ({
        value: String(p.port),
        label: `${p.port}${p.name ? ` (${p.name})` : ""}${p.protocol ? ` / ${p.protocol}` : ""}${p.targetPort ? ` -> ${p.targetPort}` : ""}${p.nodePort ? ` / node ${p.nodePort}` : ""}`,
      })),
    [knownServicePorts]
  );
  const handleOpenPortForwardDialog = () => {
    if (offline) return;
    setPortForwardError("");
    if (knownServicePorts.length > 0) {
      setPortForwardRemotePort(String(knownServicePorts[0].port));
    } else {
      setPortForwardRemotePort("");
    }
    setPortForwardLocalPort("");
    setPortForwardDialogOpen(true);
  };

  const handleCreatePortForward = async () => {
    if (offline) return;
    if (!summary?.name) {
      setPortForwardError("Service is not available.");
      return;
    }
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
          namespace: summary.namespace || ns,
          service: summary.name,
          remotePort: remote,
          localPort: local,
          title: `svc/${summary.name}:${remote}`,
        },
        props.token
      );
      setPortForwardCreatedMsg(`Port forward started: ${res.localHost}:${res.localPort} -> ${res.remotePort}`);
      emitFocusPortForwardsTab();
      setPortForwardDialogOpen(false);
    } catch {
      setPortForwardError("Failed to create port-forward session.");
    } finally {
      setCreatingPortForward(false);
    }
  };

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name) },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Type", value: valueOrDash(summary?.type) },
      { label: "Cluster IPs", value: formatClusterIPs(summary?.clusterIPs) },
      {
        label: "Selector",
        value:
          Object.entries(summary?.selector || {}).length === 0 ? (
            "-"
          ) : (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {Object.entries(summary?.selector || {}).map(([k, v]) => (
                <Tooltip key={k} title={`${k}=${v}`} arrow>
                  <KeyValueChip chipKey={k} value={v} />
                </Tooltip>
              ))}
            </Box>
          ),
      },
      { label: "Session Affinity", value: valueOrDash(summary?.sessionAffinity) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );
  const ingressesAccessDenied = ingressesErr?.status === 401 || ingressesErr?.status === 403;

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="services"
        title={
          <>
            Service: {name || "-"}{" "}
            {ns ? <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} /> : null}
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
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="Pods" />} iconPosition="start" label="Pods" />
              <Tab icon={<DetailTabIcon label="Events" />} iconPosition="start" label="Events" />
              <Tab icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  {name && (
                    <DrawerActionStrip>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<CableIcon />}
                          disabled={
                            offline ||
                            creatingPortForward ||
                            !details ||
                            knownServicePorts.length === 0
                          }
                          onClick={handleOpenPortForwardDialog}
                        >
                          Port forward
                        </Button>
                        <ServiceActions
                          token={props.token}
                          namespace={ns}
                          serviceName={name}
                          onDeleted={props.onClose}
                        />
                      </Box>
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={serviceSignals}
                    onJumpToEvents={() => setTab(2)}
                  />

                  <Section title="Ports">
                    <Box sx={panelBoxSx}>
                      {(details?.ports || []).length === 0 ? (
                        <EmptyState message="No ports defined for this Service." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Service Port</TableCell>
                              <TableCell>Target Port</TableCell>
                              <TableCell>Protocol</TableCell>
                              <TableCell>NodePort</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.ports || []).map((p, idx) => (
                              <TableRow key={`${p.name ?? "port"}-${idx}`}>
                                <TableCell>{valueOrDash(p.name)}</TableCell>
                                <TableCell>{valueOrDash(p.port)}</TableCell>
                                <TableCell>{valueOrDash(p.targetPort)}</TableCell>
                                <TableCell>{valueOrDash(p.protocol)}</TableCell>
                                <TableCell>{p.nodePort ? p.nodePort : "-"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Box>
                  </Section>

                  <Section title="Traffic Notes">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable
                        columns={2}
                        rows={[
                          {
                            label: "External Traffic Policy",
                            value: valueOrDash(details?.traffic?.externalTrafficPolicy),
                          },
                          {
                            label: "LoadBalancer Ingress",
                            value: (details?.traffic?.loadBalancerIngress || []).join(", ") || "-",
                          },
                        ]}
                      />
                    </Box>
                  </Section>

                  {(() => {
                    const urls = buildExternalUrls(summary, details?.traffic, details?.ports);
                    if (urls.length === 0) return null;
                    return (
                      <Section title="External URLs">
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
                          {urls.map((url) => (
                            <Typography
                              key={url}
                              variant="body2"
                              sx={{ fontFamily: "monospace" }}
                            >
                              <a href={url} target="_blank" rel="noopener noreferrer">
                                {url}
                              </a>
                            </Typography>
                          ))}
                        </Box>
                      </Section>
                    );
                  })()}

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* INVENTORY */}
              {tab === 1 && (
                <Box sx={drawerTabContentSx}>
                  <Section title="Endpoint Pods">
                    <Box sx={panelBoxSx}>
                      {(details?.endpoints?.pods || []).length === 0 ? (
                        <EmptyState message="No endpoints found for this Service." />
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Pod</TableCell>
                              <TableCell>Namespace</TableCell>
                              <TableCell>Node</TableCell>
                              <TableCell>Ready</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(details?.endpoints?.pods || []).map((p, idx) => (
                              <TableRow
                                key={`${p.namespace}/${p.name}-${idx}`}
                                hover
                                onClick={() => {
                                  if (!p.name) return;
                                  setDrawerPod(p.name);
                                  setDrawerPodNs(p.namespace || ns);
                                }}
                                sx={{ cursor: p.name ? "pointer" : "default" }}
                              >
                                <TableCell>{valueOrDash(p.name)}</TableCell>
                                <TableCell>{valueOrDash(p.namespace)}</TableCell>
                                <TableCell>{valueOrDash(p.node)}</TableCell>
                                <TableCell>
                                  <Chip size="small" label={p.ready ? "Ready" : "Not Ready"} color={p.ready ? "success" : "warning"} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Box>
                  </Section>

                  <Section title="Ingresses">
                    <Box sx={panelBoxSx}>
                      {ingressesLoading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
                          <CircularProgress />
                        </Box>
                      ) : ingressesAccessDenied ? (
                        <AccessDeniedState status={ingressesErr?.status} resourceLabel="Ingresses" />
                      ) : ingressesErr ? (
                        <ErrorState message={ingressesErr.message} />
                      ) : ingresses.length === 0 ? (
                        <EmptyState message="No ingresses reference this Service." />
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
                            {ingresses.map((ing) => (
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
                    </Box>
                  </Section>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/services/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this Service." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                  <MetadataSection labels={details?.summary?.labels} annotations={details?.summary?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Service",
                    group: "",
                    resource: "services",
                    apiVersion: "v1",
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
              namespace={drawerPodNs || ns}
              podName={drawerPod}
            />
            <IngressDrawer
              open={!!drawerIngress}
              onClose={() => setDrawerIngress(null)}
              token={props.token}
              namespace={drawerIngress?.namespace || ns}
              ingressName={drawerIngress?.name || null}
            />
          </>
        )}
      </ResourceDrawerShell>
      <PortForwardDialog
        open={portForwardDialogOpen}
        busy={creatingPortForward}
        targetLabel={`Target Service: ${summary?.namespace || ns}/${summary?.name || "-"}`}
        remotePort={portForwardRemotePort}
        localPort={portForwardLocalPort}
        error={portForwardError}
        disabled={offline}
        disabledReason={offlineReason}
        remotePortOptions={knownServicePortOptions}
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
      <NamespaceDrawer
        open={!!drawerNamespace}
        onClose={() => setDrawerNamespace(null)}
        token={props.token}
        namespaceName={drawerNamespace}
      />
    </RightDrawer>
  );
}
