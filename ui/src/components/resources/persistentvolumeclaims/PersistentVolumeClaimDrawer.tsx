import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { pvcPhaseChipColor } from "../../../utils/k8sUi";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import KeyValueChip from "../../shared/KeyValueChip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import EventsList from "../../shared/EventsList";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import PersistentVolumeDrawer from "../persistentvolumes/PersistentVolumeDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import PVCActions from "./PVCActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import StatusChip from "../../shared/StatusChip";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";
import useAccessReview from "../../../utils/useAccessReview";
import { listResourceAccess } from "../../../utils/k8sResources";

type PersistentVolumeClaimDetails = {
  summary: PersistentVolumeClaimSummary;
  spec: PersistentVolumeClaimSpec;
  status: PersistentVolumeClaimStatus;
  metadata: PersistentVolumeClaimMetadata;
  yaml: string;
};

type PersistentVolumeClaimSummary = {
  name: string;
  namespace: string;
  phase?: string;
  storageClassName?: string;
  volumeName?: string;
  accessModes?: string[];
  requestedStorage?: string;
  capacity?: string;
  volumeMode?: string;
  ageSec?: number;
  createdAt?: number;
};

type PersistentVolumeClaimSpec = {
  accessModes?: string[];
  volumeMode?: string;
  requests?: { storage?: string };
  selector?: LabelSelector;
  dataSource?: DataSourceRef;
  dataSourceRef?: DataSourceRef;
  finalizers?: string[];
};

type PersistentVolumeClaimStatus = {
  phase?: string;
  capacity?: string;
  conditions?: PersistentVolumeClaimCondition[];
};

type PersistentVolumeClaimCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type PersistentVolumeClaimMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type LabelSelector = {
  matchLabels?: Record<string, string>;
  matchExpressions?: LabelSelectorExpression[];
};

type LabelSelectorExpression = {
  key?: string;
  operator?: string;
  values?: string[];
};

type DataSourceRef = {
  kind?: string;
  name?: string;
  apiGroup?: string;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

function formatAccessModes(modes?: string[]) {
  if (!modes || modes.length === 0) return "-";
  return modes.join(", ");
}

function formatDataSource(ds?: DataSourceRef) {
  if (!ds?.kind && !ds?.name) return "-";
  const base = [ds.kind, ds.name].filter(Boolean).join("/");
  return ds?.apiGroup ? `${base} (${ds.apiGroup})` : base;
}

function formatExpression(expr: LabelSelectorExpression) {
  const values = (expr.values || []).join(", ");
  if (!expr.key && !expr.operator) return "-";
  if (!values) return `${expr.key} ${expr.operator}`.trim();
  return `${expr.key} ${expr.operator} (${values})`.trim();
}

export default function PersistentVolumeClaimDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  persistentVolumeClaimName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<PersistentVolumeClaimDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [drawerPV, setDrawerPV] = useState<string | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.persistentVolumeClaimName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPV(null);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<PersistentVolumeClaimDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(name)}`,
        props.token
      );
      const item: PersistentVolumeClaimDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/persistentvolumeclaims/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const spec = details?.spec;
  const metadata = details?.metadata;
  const status = details?.status;
  const volumeName = summary?.volumeName;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "persistentvolumeclaims",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });
  const pvAccess = useAccessReview({
    token: props.token,
    resource: listResourceAccess.persistentvolumes,
    namespace: null,
    verb: "get",
    enabled: !!volumeName,
  });
  const showPvDeniedHint = !!volumeName && pvAccess.allowed === false;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      {
        label: "Status",
        value: <StatusChip label={valueOrDash(summary?.phase)} color={pvcPhaseChipColor(summary?.phase)} />,
      },
      { label: "Storage Class", value: valueOrDash(summary?.storageClassName) },
      { label: "Volume Mode", value: valueOrDash(summary?.volumeMode) },
      { label: "Access Modes", value: formatAccessModes(summary?.accessModes) },
      { label: "Requested", value: valueOrDash(summary?.requestedStorage) },
      { label: "Capacity", value: valueOrDash(summary?.capacity) },
      {
        label: "Bound PV",
        value: volumeName ? (
          <ResourceLinkChip
            label={volumeName}
            onClick={pvAccess.allowed ? () => setDrawerPV(volumeName) : undefined}
            sx={!pvAccess.allowed ? { opacity: 0.6 } : undefined}
          />
        ) : (
          "-"
        ),
        monospace: true,
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary, volumeName, pvAccess.allowed]
  );

  const selectorLabels = Object.entries(spec?.selector?.matchLabels || {});
  const selectorExpr = spec?.selector?.matchExpressions || [];
  const finalizers = spec?.finalizers || [];
  const conditions = status?.conditions || [];
  const pvcSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        title={
          <>
            PVC: {name || "-"}{" "}
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
              <Tab label="Overview" />
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
                    <Section title="Actions" divider={false}>
                      <PVCActions
                        token={props.token}
                        namespace={ns}
                        pvcName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={pvcSignals}
                    onJumpToEvents={() => setTab(2)}
                    onJumpToSpec={() => setTab(1)}
                  />

                  <ConditionsTable
                    conditions={conditions}
                    variant="section"
                    title="Status"
                    emptyMessage="No conditions reported for this PVC."
                    unhealthyFirst
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* SPEC */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Section title="Spec Summary">
                    <KeyValueTable
                      columns={3}
                      sx={{ mt: 1 }}
                      rows={[
                        { label: "Access Modes", value: formatAccessModes(spec?.accessModes) },
                        { label: "Volume Mode", value: valueOrDash(spec?.volumeMode) },
                        { label: "Requested Storage", value: valueOrDash(spec?.requests?.storage) },
                        { label: "Capacity", value: valueOrDash(status?.capacity) },
                        { label: "Data Source", value: formatDataSource(spec?.dataSource) },
                        { label: "Data Source Ref", value: formatDataSource(spec?.dataSourceRef) },
                      ]}
                    />
                  </Section>

                  <Section title="Selector">
                    {selectorLabels.length === 0 && selectorExpr.length === 0 ? (
                      <EmptyState message="No selector defined." sx={{ mt: 1 }} />
                    ) : (
                      <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                        {selectorLabels.length > 0 && (
                          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                            {selectorLabels.map(([k, v]) => (
                              <KeyValueChip key={`${k}=${v}`} chipKey={k} value={v} />
                            ))}
                          </Box>
                        )}
                        {selectorExpr.length > 0 && (
                          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                            {selectorExpr.map((expr, idx) => (
                              <StatusChip key={`${expr.key ?? "expr"}-${idx}`} size="small" label={formatExpression(expr)} variant="outlined" />
                            ))}
                          </Box>
                        )}
                      </Box>
                    )}
                  </Section>

                  <Section title="Finalizers">
                    {finalizers.length === 0 ? (
                      <EmptyState message="No finalizers." sx={{ mt: 1 }} />
                    ) : (
                      <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {finalizers.map((f) => (
                          <Chip key={f} size="small" label={f} />
                        ))}
                      </Box>
                    )}
                  </Section>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this PVC." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                    {showPvDeniedHint ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                        Access denied: you don't have permission to view PersistentVolumes.
                      </Typography>
                    ) : null}
                  </Box>
                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "PersistentVolumeClaim",
                    group: "",
                    resource: "persistentvolumeclaims",
                    apiVersion: "v1",
                    namespace: ns,
                    name: name || "",
                  }}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>
      <PersistentVolumeDrawer
        open={!!drawerPV}
        onClose={() => setDrawerPV(null)}
        token={props.token}
        persistentVolumeName={drawerPV}
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
