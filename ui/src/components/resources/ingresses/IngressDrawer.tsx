import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import ServiceDrawer from "../services/ServiceDrawer";
import { fmtAge, valueOrDash } from "../../../utils/format";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import WarningsSection, { type Warning } from "../../shared/WarningsSection";
import MetadataSection from "../../shared/MetadataSection";
import EventsList from "../../shared/EventsList";
import CodeBlock from "../../shared/CodeBlock";
import IngressActions from "./IngressActions";
import RightDrawer from "../../layout/RightDrawer";

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
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/ingresses/${encodeURIComponent(name)}`,
        props.token
      );
      const item: IngressDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
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

  const ingressWarnings = useMemo((): Warning[] => {
    const warnings: Warning[] = [];

    // Warn for each backend service with no ready endpoints
    noReadyBackends.forEach((svc) => {
      warnings.push({
        message: `Ingress routes to Service "${svc}" but it has no ready endpoints.`,
      });
    });

    // Missing backend services are also a concern
    missingBackends.forEach((svc) => {
      warnings.push({
        message: `Ingress references Service "${svc}" which does not exist.`,
      });
    });

    return warnings;
  }, [missingBackends, noReadyBackends]);

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
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Ingress: {name || "-"} <Typography component="span" variant="body2">({ns})</Typography>
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
              <Tab label="Rules" />
              <Tab label="TLS" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
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

                  <WarningsSection warnings={ingressWarnings} />

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

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

                  <MetadataSection labels={summary?.labels} annotations={summary?.annotations} />
                </Box>
              )}

              {/* RULES */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
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

              {/* YAML */}
              {tab === 4 && (
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
      </Box>
    </RightDrawer>
  );
}
