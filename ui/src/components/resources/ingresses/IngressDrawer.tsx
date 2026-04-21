import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import ServiceDrawer from "../services/ServiceDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import AttentionSummary, {
  type AttentionHealth,
  type AttentionReason,
} from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import EventsList from "../../shared/EventsList";
import CodeBlock from "../../shared/CodeBlock";
import IngressActions from "./IngressActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

function buildIngressUrls(hosts?: string[], tls?: IngressTLS[]): { host: string; url: string }[] {
  if (!hosts || hosts.length === 0) return [];
  const tlsHosts = new Set<string>();
  (tls || []).forEach((t) => (t.hosts || []).forEach((h) => tlsHosts.add(h)));
  return hosts.map((host) => {
    const proto = tlsHosts.has(host) ? "https" : "http";
    return { host, url: `${proto}://${host}` };
  });
}

type IngressDetails = {
  summary: IngressSummary;
  rules: IngressRule[];
  tls: IngressTLS[];
  defaultBackend?: IngressBackend;
  warnings: IngressWarnings;
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

type IngressSummary = {
  name: string;
  namespace: string;
  ingressClassName?: string;
  addresses?: string[];
  hosts?: string[];
  tlsCount?: number;
  ageSec?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type IngressRule = {
  host: string;
  paths: IngressPath[];
};

type IngressPath = {
  path: string;
  pathType: string;
  backendServiceName: string;
  backendServicePort: string;
};

type IngressTLS = {
  secretName: string;
  hosts?: string[];
};

type IngressBackend = {
  serviceName: string;
  servicePort: string;
};

type IngressWarnings = {
  missingBackendServices?: string[];
  noReadyEndpoints?: string[];
};

function formatHostsSummary(hosts?: string[]) {
  if (!hosts || hosts.length === 0) return "-";
  const short = hosts.slice(0, 3).join(", ");
  if (hosts.length <= 3) return `${hosts.length} (${short})`;
  return `${hosts.length} (${short}, +${hosts.length - 3} more)`;
}

function formatAddresses(addrs?: string[]) {
  if (!addrs || addrs.length === 0) return "-";
  return addrs.join(", ");
}

function formatTLSCount(count?: number) {
  if (!count || count <= 0) return "0";
  return String(count);
}

export default function IngressDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  ingressName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<IngressDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [drawerService, setDrawerService] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.ingressName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerService(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<IngressDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/ingresses/${encodeURIComponent(name)}`,
        props.token
      );
      const item: IngressDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/ingresses/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const backendWarnings = details?.warnings;
  const missingBackends = backendWarnings?.missingBackendServices || [];
  const noReadyBackends = backendWarnings?.noReadyEndpoints || [];
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "ingresses",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const ingressSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const attentionHealth = useMemo<AttentionHealth | undefined>(() => {
    if (!summary) return undefined;
    const hostCount = summary.hosts?.length || 0;
    const tone: AttentionHealth["tone"] =
      missingBackends.length > 0 ? "error" : noReadyBackends.length > 0 ? "warning" : "success";
    return {
      label: `Hosts ${hostCount} · TLS ${summary.tlsCount || 0}`,
      tone,
      tooltip: `Addresses ${summary.addresses?.length || 0} · backend warnings ${missingBackends.length + noReadyBackends.length}`,
    };
  }, [summary, missingBackends.length, noReadyBackends.length]);

  const attentionReasons = useMemo<AttentionReason[]>(() => {
    const reasons: AttentionReason[] = [];
    if (noReadyBackends.length > 0) {
      reasons.push({
        label: `${noReadyBackends.length} backend service(s) without ready endpoints`,
        severity: "warning",
      });
    }
    if (missingBackends.length > 0) {
      reasons.push({
        label: `${missingBackends.length} missing backend service(s)`,
        severity: "error",
      });
    }
    return reasons;
  }, [missingBackends.length, noReadyBackends.length]);

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name) },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Ingress Class", value: valueOrDash(summary?.ingressClassName) },
      { label: "Addresses", value: formatAddresses(summary?.addresses) },
      { label: "Hosts", value: formatHostsSummary(summary?.hosts) },
      { label: "TLS Entries", value: formatTLSCount(summary?.tlsCount) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            Ingress: {name || "-"} <Typography component="span" variant="body2">({ns})</Typography>
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
              <Tab label="Rules" />
              <Tab label="TLS" />
              <Tab label="Events" />
              <Tab label="Metadata" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <IngressActions
                        token={props.token}
                        namespace={ns}
                        ingressName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    health={attentionHealth}
                    reasons={attentionReasons}
                    signals={ingressSignals}
                    onJumpToEvents={() => setTab(3)}
                  />

                  {(() => {
                    const urls = buildIngressUrls(summary?.hosts, details?.tls);
                    if (urls.length === 0) return null;
                    return (
                      <Section title="URLs">
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 1 }}>
                          {urls.map((u) => (
                            <Typography
                              key={u.host}
                              variant="body2"
                              sx={{ fontFamily: "monospace" }}
                            >
                              <a href={u.url} target="_blank" rel="noopener noreferrer">
                                {u.url}
                              </a>
                            </Typography>
                          ))}
                        </Box>
                      </Section>
                    );
                  })()}

                  <Section title="Default Backend">
                    {!details?.defaultBackend?.serviceName ? (
                      <EmptyState message="No default backend configured." sx={{ mt: 1 }} />
                    ) : (
                      <KeyValueTable
                        columns={2}
                        sx={{ mt: 1 }}
                        rows={[
                          { label: "Service", value: valueOrDash(details.defaultBackend.serviceName) },
                          { label: "Port", value: valueOrDash(details.defaultBackend.servicePort) },
                        ]}
                      />
                    )}
                  </Section>

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* RULES */}
              {tab === 1 && (
                <Box sx={drawerTabContentCompactSx}>
                  {(details?.rules || []).length === 0 ? (
                    <EmptyState message="No rules configured for this Ingress." />
                  ) : (
                    (details?.rules || []).map((rule, idx) => {
                      const ruleUrls = buildIngressUrls(rule.host ? [rule.host] : [], details?.tls);
                      const ruleUrl = ruleUrls[0]?.url;
                      return (
                      <Section
                        key={`${rule.host || "rule"}-${idx}`}
                        title={
                          ruleUrl ? (
                            <>Host: <a href={ruleUrl} target="_blank" rel="noopener noreferrer">{rule.host}</a></>
                          ) : (
                            `Host: ${valueOrDash(rule.host)}`
                          )
                        }
                        dividerPlacement="content"
                        sx={{ mt: idx === 0 ? 0 : 1 }}
                      >
                        {(rule.paths || []).length === 0 ? (
                          <EmptyState message="No paths configured for this host." sx={{ mt: 1 }} />
                        ) : (
                          <Table size="small" sx={{ mt: 1 }}>
                            <TableHead>
                              <TableRow>
                                <TableCell>Path</TableCell>
                                <TableCell>PathType</TableCell>
                                <TableCell>Backend Service</TableCell>
                                <TableCell>Backend Port</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {(rule.paths || []).map((p, pIdx) => (
                                <TableRow key={`${rule.host || "rule"}-${p.path || "path"}-${pIdx}`} hover>
                                  <TableCell>{valueOrDash(p.path)}</TableCell>
                                  <TableCell>{valueOrDash(p.pathType)}</TableCell>
                                  <TableCell>
                                    {p.backendServiceName ? (
                                      <ResourceLinkChip
                                        label={p.backendServiceName}
                                        onClick={() => setDrawerService(p.backendServiceName)}
                                      />
                                    ) : (
                                      "-"
                                    )}
                                  </TableCell>
                                  <TableCell>{valueOrDash(p.backendServicePort)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </Section>
                    );
                    })
                  )}
                </Box>
              )}

              {/* TLS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {(details?.tls || []).length === 0 ? (
                    <EmptyState message="No TLS configured for this Ingress." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Secret</TableCell>
                          <TableCell>Hosts</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(details?.tls || []).map((t, idx) => (
                          <TableRow key={`${t.secretName || "tls"}-${idx}`}>
                            <TableCell>{valueOrDash(t.secretName)}</TableCell>
                            <TableCell>{valueOrDash((t.hosts || []).join(", "))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this Ingress." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 4 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                  <MetadataSection labels={summary?.labels} annotations={summary?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
            <ServiceDrawer
              open={!!drawerService}
              onClose={() => setDrawerService(null)}
              token={props.token}
              namespace={ns}
              serviceName={drawerService}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
