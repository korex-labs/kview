import React, { useEffect, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { conditionStatusColor, deploymentHealthBucketColor } from "../../../utils/k8sUi";
import useResourceSignals from "../../../utils/useResourceSignals";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AccessDeniedState from "../../shared/AccessDeniedState";
import MetadataSection from "../../shared/MetadataSection";
import EventsList from "../../shared/EventsList";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ScopedCountChip from "../../shared/ScopedCountChip";
import StatusChip from "../../shared/StatusChip";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import AttentionSummary, {
} from "../../shared/AttentionSummary";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import type { ApiItemResponse, ApiListResponse, EventDTO } from "../../../types/api";
import { drawerBodySx, drawerTabContentCompactSx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";

const tabs = ["Signals", "Events", "Metadata", "YAML"] as const;
const eventsTabIndex = tabs.indexOf("Events");
const metadataTabIndex = tabs.indexOf("Metadata");
const yamlTabIndex = tabs.indexOf("YAML");

type HPA = {
  name: string;
  namespace: string;
  scaleTargetRef?: { kind?: string; name?: string; apiVersion?: string };
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  currentGauge?: HPAGauge;
  desiredGauge?: HPAGauge;
  currentMetrics?: HPAMetric[];
  conditions?: HPACondition[];
  ageSec: number;
  healthBucket?: string;
  needsAttention?: boolean;
  attentionReasons?: string[];
  lastScaleTime?: number;
};

type HPADetails = {
  summary: HPA;
  spec: {
    scaleTargetRef?: { kind?: string; name?: string; apiVersion?: string };
    minReplicas: number;
    maxReplicas: number;
    behavior?: string;
  };
  metrics?: HPAMetric[];
  conditions?: HPACondition[];
  metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
  yaml: string;
};

type HPAMetric = {
  type: string;
  name?: string;
  target?: string;
  current?: string;
  currentValue?: number;
  targetValue?: number;
  gaugePercent?: number;
  gaugeTone?: GaugeTone;
};

type HPAGauge = {
  value: number;
  max: number;
  percent: number;
  tone?: GaugeTone;
};

type HPACondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

function targetRefText(ref?: { kind?: string; name?: string; apiVersion?: string }) {
  if (!ref?.kind && !ref?.name) return "-";
  const base = [ref.kind, ref.name].filter(Boolean).join("/");
  return ref.apiVersion ? `${base} (${ref.apiVersion})` : base;
}


export default function HorizontalPodAutoscalerDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  hpaName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<HPADetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState(0);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.hpaName;

  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "horizontalpodautoscalers",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  useEffect(() => {
    if (!props.open || !name) return;
    setLoading(true);
    setErr("");
    setDenied(false);
    setTab(0);
    setDrawerNamespace(null);
    setDetails(null);
    setEvents([]);

    (async () => {
      const det = await apiGet<ApiItemResponse<HPADetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/horizontalpodautoscalers/${encodeURIComponent(name)}`,
        props.token,
      );
      setDetails(det.item || null);
      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/horizontalpodautoscalers/${encodeURIComponent(name)}/events`,
        props.token,
      );
      setEvents(ev.items || []);
    })()
      .catch((e: unknown) => {
        const status = (e as { status?: number } | undefined)?.status;
        if (status === 401 || status === 403) setDenied(true);
        else setErr(String((e as Error | undefined)?.message || e || "Failed to load HPA"));
      })
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  return (
    <>
      <RightDrawer open={props.open} onClose={props.onClose}>
        <ResourceDrawerShell
          title={
            <>
              HPA: {name || "-"}{" "}
              {ns ? <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} /> : null}
            </>
          }
          onClose={props.onClose}
        >
        {loading ? (
          <Box sx={loadingCenterSx}><CircularProgress size={24} /></Box>
        ) : denied ? (
          <AccessDeniedState title="Access denied" message="You do not have permission to read this HorizontalPodAutoscaler." />
        ) : err ? (
          <ErrorState message={err} />
        ) : !details ? (
          <EmptyState message="No HPA details loaded." />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              {tabs.map((label) => (
                <Tab key={label} label={label} />
              ))}
            </Tabs>

            <Box sx={drawerBodySx}>
              {tab === 0 && (() => {
                return (
                <Box sx={drawerTabContentCompactSx}>
                  <AttentionSummary
                    signals={resourceSignals.signals}
                    onJumpToEvents={() => setTab(eventsTabIndex)}
                    onJumpToSpec={() => setTab(metadataTabIndex)}
                  />

                  <Section title="Scaling signals">
                    <Box sx={panelBoxSx}>
                      <GaugeTableRow
                        label="Current replicas"
                        bar={<GaugeBar value={details.summary.currentGauge?.percent ?? 0} tone={details.summary.currentGauge?.tone} />}
                        summary={`${details.summary.currentReplicas} current / ${details.summary.maxReplicas} max`}
                      />
                      <GaugeTableRow
                        label="Desired replicas"
                        bar={<GaugeBar value={details.summary.desiredGauge?.percent ?? 0} tone={details.summary.desiredGauge?.tone} />}
                        summary={`${details.summary.desiredReplicas} desired / min ${details.summary.minReplicas}`}
                      />
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                        <ScopedCountChip size="small" variant="outlined" label="Min" count={details.summary.minReplicas} />
                        <ScopedCountChip size="small" variant="outlined" label="Max" count={details.summary.maxReplicas} />
                        <ScopedCountChip size="small" variant="outlined" label="Last scale" count={details.summary.lastScaleTime ? fmtTs(details.summary.lastScaleTime) : "-"} />
                      </Box>
                    </Box>
                  </Section>

                  <Section title="Metric targets">
                    {!details.metrics?.length ? (
                      <EmptyState message="No metric targets configured." />
                    ) : (
                      <Box sx={panelBoxSx}>
                        {details.metrics.map((metric, idx) => (
                          <GaugeTableRow
                            key={`${metric.type}-${metric.name || idx}`}
                            label={[metric.type, metric.name].filter(Boolean).join(" / ") || "Metric"}
                            bar={<GaugeBar value={metric.gaugePercent ?? 0} tone={metric.gaugeTone ?? "default"} />}
                            summary={`${valueOrDash(metric.current)} / ${valueOrDash(metric.target)}`}
                          />
                        ))}
                      </Box>
                    )}
                  </Section>

                  <Section title="Conditions">
                    {!details.conditions?.length ? (
                      <EmptyState message="No conditions reported." />
                    ) : (
                      <Table size="small" sx={{ width: "100%", tableLayout: "fixed" }}>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ width: "22%" }}>Type</TableCell>
                            <TableCell sx={{ width: "14%" }}>Status</TableCell>
                            <TableCell>Reason</TableCell>
                            <TableCell sx={{ width: "18%" }}>Changed</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {details.conditions.map((cond) => (
                            <TableRow key={cond.type}>
                              <TableCell sx={{ overflowWrap: "anywhere" }}>{cond.type}</TableCell>
                              <TableCell><StatusChip label={cond.status} color={conditionStatusColor(cond.status)} /></TableCell>
                              <TableCell sx={{ overflowWrap: "anywhere" }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>{valueOrDash(cond.reason)}</Typography>
                                {cond.message ? (
                                  <Typography variant="caption" color="text.secondary">{cond.message}</Typography>
                                ) : null}
                              </TableCell>
                              <TableCell sx={{ overflowWrap: "anywhere" }}>{cond.lastTransitionTime ? fmtTs(cond.lastTransitionTime) : "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Section>
                </Box>
                );
              })()}

              {tab === eventsTabIndex && (
                <Box sx={drawerTabContentCompactSx}>
                  <EventsList events={events} />
                </Box>
              )}

              {tab === metadataTabIndex && (
                <Box sx={drawerTabContentCompactSx}>
                  <Section
                    title="Summary"
                    actions={
                      <Chip
                        size="small"
                        label={details.summary.needsAttention ? "attention" : details.summary.healthBucket || "unknown"}
                        color={deploymentHealthBucketColor(details.summary.healthBucket)}
                      />
                    }
                  >
                    <Box sx={panelBoxSx}>
                      <KeyValueTable
                        rows={[
                          { label: "Name", value: details.summary.name, monospace: true },
                          { label: "Namespace", value: details.summary.namespace, monospace: true },
                          { label: "Target", value: targetRefText(details.summary.scaleTargetRef) },
                          { label: "Replicas", value: `${details.summary.currentReplicas}/${details.summary.desiredReplicas}` },
                          { label: "Min / Max", value: `${details.summary.minReplicas} / ${details.summary.maxReplicas}` },
                          { label: "Last Scale", value: details.summary.lastScaleTime ? fmtTs(details.summary.lastScaleTime) : "-" },
                          { label: "Age", value: fmtAge(details.summary.ageSec, "detail") },
                        ]}
                        valueSx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                      />
                    </Box>
                  </Section>

                  <Section title="Scaling Spec">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable
                        rows={[
                          { label: "Scale Target", value: targetRefText(details.spec.scaleTargetRef) },
                          { label: "Min Replicas", value: details.spec.minReplicas },
                          { label: "Max Replicas", value: details.spec.maxReplicas },
                          { label: "Behavior", value: valueOrDash(details.spec.behavior) },
                        ]}
                        columns={2}
                      />
                    </Box>
                  </Section>

                  <Section title="Labels and annotations">
                    <MetadataSection labels={details.metadata?.labels} annotations={details.metadata?.annotations} wrapInSection={false} />
                  </Section>
                </Box>
              )}

              {tab === yamlTabIndex && (
                <Box sx={drawerTabContentCompactSx}>
                  <ResourceYamlPanel
                    code={details.yaml || ""}
                    token={props.token}
                    target={{
                      kind: "HorizontalPodAutoscaler",
                      group: "autoscaling",
                      resource: "horizontalpodautoscalers",
                      apiVersion: "autoscaling/v2",
                      namespace: ns,
                      name: name || "",
                    }}
                  />
                </Box>
              )}
            </Box>
          </>
        )}
        </ResourceDrawerShell>
      </RightDrawer>
      <NamespaceDrawer
        open={!!drawerNamespace}
        onClose={() => setDrawerNamespace(null)}
        token={props.token}
        namespaceName={drawerNamespace}
      />
    </>
  );
}
