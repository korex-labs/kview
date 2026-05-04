import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
} from "@mui/material";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { pvPhaseChipColor } from "../../../utils/k8sUi";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import PersistentVolumeClaimDrawer from "../persistentvolumeclaims/PersistentVolumeClaimDrawer";
import PVActions from "./PVActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import StatusChip from "../../shared/StatusChip";
import type { DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  fetchClusterResourceDetailWithWarnings,
  type ResourceWarningEvent,
} from "../../../utils/resourceDrawerFetch";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  drawerTabContentCompactSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";
import useAccessReview from "../../../utils/useAccessReview";
import { listResourceAccess } from "../../../utils/k8sResources";

type PersistentVolumeDetails = {
  summary: PersistentVolumeSummary;
  spec: PersistentVolumeSpec;
  status: PersistentVolumeStatus;
  metadata: PersistentVolumeMetadata;
  yaml: string;
};

type PersistentVolumeSummary = {
  name: string;
  phase?: string;
  capacity?: string;
  accessModes?: string[];
  storageClassName?: string;
  reclaimPolicy?: string;
  volumeMode?: string;
  claimRef?: PersistentVolumeClaimRef;
  ageSec?: number;
  createdAt?: number;
};

type PersistentVolumeSpec = {
  accessModes?: string[];
  volumeMode?: string;
  storageClassName?: string;
  reclaimPolicy?: string;
  mountOptions?: string[];
  volumeSource?: PersistentVolumeSource;
};

type PersistentVolumeSource = {
  type?: string;
  details?: PersistentVolumeSourceDetail[];
};

type PersistentVolumeSourceDetail = {
  label: string;
  value: string;
};

type PersistentVolumeStatus = {
  phase?: string;
  capacity?: string;
  conditions?: PersistentVolumeCondition[];
};

type PersistentVolumeCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type PersistentVolumeMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type PersistentVolumeClaimRef = {
  namespace?: string;
  name?: string;
};

function formatAccessModes(modes?: string[]) {
  if (!modes || modes.length === 0) return "-";
  return modes.join(", ");
}

function formatMountOptions(opts?: string[]) {
  if (!opts || opts.length === 0) return "-";
  return opts.join(", ");
}

function formatClaimRef(ref?: PersistentVolumeClaimRef) {
  if (!ref?.name) return "-";
  if (ref.namespace) return `${ref.namespace}/${ref.name}`;
  return ref.name;
}

export default function PersistentVolumeDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  persistentVolumeName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<PersistentVolumeDetails | null>(null);
  const [events, setEvents] = useState<ResourceWarningEvent[]>([]);
  const [err, setErr] = useState("");
  const [drawerPVC, setDrawerPVC] = useState<{ name: string; namespace: string } | null>(null);

  const name = props.persistentVolumeName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerPVC(null);
    setLoading(true);

    fetchClusterResourceDetailWithWarnings<PersistentVolumeDetails>({
      token: props.token,
      resource: "persistentvolumes",
      name,
    })
      .then((res) => {
        setDetails(res.item);
        setEvents(res.warningEvents);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const spec = details?.spec;
  const metadata = details?.metadata;
  const status = details?.status;
  const claimRef = summary?.claimRef;
  const claimNs = claimRef?.namespace || "";
  const claimName = claimRef?.name || "";
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "cluster",
    kind: "persistentvolumes",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const pvcAccess = useAccessReview({
    token: props.token,
    resource: listResourceAccess.persistentvolumeclaims,
    namespace: claimNs || null,
    verb: "get",
    enabled: !!claimName && !!claimNs,
  });
  const showPvcDeniedHint = !!claimName && !!claimNs && pvcAccess.allowed === false;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Phase",
        value: <StatusChip label={valueOrDash(summary?.phase)} color={pvPhaseChipColor(summary?.phase)} />,
      },
      { label: "Capacity", value: valueOrDash(summary?.capacity) },
      { label: "Access Modes", value: formatAccessModes(summary?.accessModes) },
      { label: "Storage Class", value: valueOrDash(summary?.storageClassName) },
      { label: "Reclaim Policy", value: valueOrDash(summary?.reclaimPolicy) },
      { label: "Volume Mode", value: valueOrDash(summary?.volumeMode) },
      {
        label: "Claim",
        value: claimName ? (
          <ResourceLinkChip
            label={formatClaimRef(claimRef)}
            onClick={
              claimNs && pvcAccess.allowed ? () => setDrawerPVC({ name: claimName, namespace: claimNs }) : undefined
            }
            sx={!claimNs || !pvcAccess.allowed ? { opacity: 0.6 } : undefined}
          />
        ) : (
          "-"
        ),
        monospace: true,
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary, claimName, claimNs, pvcAccess.allowed, claimRef]
  );

  const source = spec?.volumeSource;
  const sourceDetails = source?.details || [];
  const conditions = status?.conditions || [];
  const pvSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="persistentvolumes" title={<>PV: {name || "-"}</>} onClose={props.onClose}>
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
              <Tab icon={<DetailTabIcon label="Spec" />} iconPosition="start" label="Spec" />
              <Tab icon={<DetailTabIcon label="Events" />} iconPosition="start" label="Events" />
              <Tab icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <DrawerActionStrip>
                      <PVActions
                        token={props.token}
                        pvName={name}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={pvSignals}
                    onJumpToEvents={() => setTab(2)}
                    onJumpToSpec={() => setTab(1)}
                  />

                  <ConditionsTable
                    conditions={conditions}
                    variant="section"
                    title="Status"
                    emptyMessage="No conditions reported for this PV."
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
                        { label: "Storage Class", value: valueOrDash(spec?.storageClassName) },
                        { label: "Reclaim Policy", value: valueOrDash(spec?.reclaimPolicy) },
                        { label: "Capacity", value: valueOrDash(status?.capacity) },
                        { label: "Mount Options", value: formatMountOptions(spec?.mountOptions) },
                      ]}
                    />
                  </Section>

                  <Section title="Volume Source">
                    {!source?.type && sourceDetails.length === 0 ? (
                      <EmptyState message="No volume source details available." sx={{ mt: 1 }} />
                    ) : (
                      <KeyValueTable
                        columns={2}
                        sx={{ mt: 1 }}
                        rows={[
                          { label: "Type", value: valueOrDash(source?.type) },
                          ...sourceDetails.map((d) => ({ label: d.label, value: valueOrDash(d.value) })),
                        ]}
                      />
                    )}
                  </Section>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/persistentvolumes/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this PV." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                    {showPvcDeniedHint ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                        Access denied: you don't have permission to view PersistentVolumeClaims.
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
                    kind: "PersistentVolume",
                    group: "",
                    resource: "persistentvolumes",
                    apiVersion: "v1",
                    name: name || "",
                  }}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>

      <PersistentVolumeClaimDrawer
        open={!!drawerPVC}
        onClose={() => setDrawerPVC(null)}
        token={props.token}
        namespace={drawerPVC?.namespace || ""}
        persistentVolumeClaimName={drawerPVC?.name || null}
      />
    </RightDrawer>
  );
}
