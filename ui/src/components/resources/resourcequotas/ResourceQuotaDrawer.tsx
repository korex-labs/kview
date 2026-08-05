import React, { useMemo, useState } from "react";
import { Box, CircularProgress, Tab, Tabs } from "@mui/material";
import { useConnectionState } from "../../../connectionState";
import type { ResourceQuotaDetails } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import useNamespacedResourceDrawerDetail from "../../../utils/useNamespacedResourceDrawerDetail";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import ErrorState from "../../shared/ErrorState";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import KeyValueTable from "../../shared/KeyValueTable";
import MetadataSection from "../../shared/MetadataSection";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import RightDrawer from "../../layout/RightDrawer";
import Section from "../../shared/Section";
import DetailTabIcon from "../../shared/DetailTabIcon";
import { drawerTabProps, type DrawerTabActionId } from "../../../keyboard/actions";
import { drawerBodySx, drawerTabContentSx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";
import ResourceQuotaActions from "./ResourceQuotaActions";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";

const tabs = ["Overview", "Events", "Metadata", "YAML"];
const tabActionIds = [
  "drawer.tab.overview", "drawer.tab.events", "drawer.tab.metadata", "drawer.tab.yaml",
] satisfies DrawerTabActionId[];

function quotaGaugeTone(ratio?: number): GaugeTone {
  if (ratio == null) return "success";
  if (ratio >= 0.95) return "error";
  if (ratio >= 0.8) return "warning";
  return "success";
}

export default function ResourceQuotaDrawer({
  open,
  onClose,
  token,
  namespace,
  resourceQuotaName,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  resourceQuotaName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);
  const { loading, details, events, error: err, refresh } = useNamespacedResourceDrawerDetail<ResourceQuotaDetails>({
    open,
    token,
    namespace,
    resource: "resourcequotas",
    name: resourceQuotaName,
    retryNonce,
    onReset: () => {
      setTab(0);
      setDrawerNamespace(null);
    },
  });

  const summary = details?.summary;
  const summaryRows = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Namespace",
        value: summary?.namespace ? <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} /> : "-",
      },
      { label: "Entries", value: valueOrDash(summary?.entries?.length) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary],
  );

  return (
    <RightDrawer open={open} onClose={onClose}>
      <ResourceDrawerShell
        resourceIcon="resourcequotas"
        title={`ResourceQuota: ${resourceQuotaName || "-"}`}
        resourceIdentity={{ resource: "resourcequotas", namespace, name: resourceQuotaName }}
        onClose={onClose}
      >
        {loading ? (
          <Box sx={loadingCenterSx}><CircularProgress /></Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              {tabs.map((label, index) => (
                <Tab key={label} {...drawerTabProps(tabActionIds[index])} icon={<DetailTabIcon label={label} />} iconPosition="start" label={label} />
              ))}
            </Tabs>
            <Box sx={drawerBodySx}>
              {tab === 0 ? (
                <Box sx={drawerTabContentSx}>
                  <DrawerActionStrip>
                    {resourceQuotaName ? (
                      <ResourceQuotaActions
                        token={token}
                        namespace={namespace}
                        resourceQuotaName={resourceQuotaName}
                        onDeleted={onClose}
                      />
                    ) : null}
                  </DrawerActionStrip>
                  <Section title="Summary">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable rows={summaryRows} columns={2} />
                    </Box>
                  </Section>
                  <Section title="Usage">
                    <Box sx={panelBoxSx}>
                      {(summary?.entries || []).map((entry) => {
                        const pct = entry.ratio != null ? Math.round(entry.ratio * 100) : null;
                        return (
                          <GaugeTableRow
                            key={entry.key}
                            label={entry.key}
                            bar={<GaugeBar value={pct ?? 0} tone={quotaGaugeTone(entry.ratio)} />}
                            summary={pct != null ? `${pct}% · ${entry.used} / ${entry.hard}` : `${entry.used} / ${entry.hard}`}
                          />
                        );
                      })}
                    </Box>
                  </Section>
                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={events} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              ) : null}
              {tab === 1 ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel
                    endpoint={`/api/namespaces/${encodeURIComponent(namespace)}/resourcequotas/${encodeURIComponent(resourceQuotaName || "")}/events`}
                    token={token}
                    emptyMessage="No events found for this ResourceQuota."
                  />
                </Box>
              ) : null}
              {tab === 2 ? (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryRows} columns={3} />
                  </Box>
                  <MetadataSection labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} />
                </Box>
              ) : null}
              {tab === 3 ? (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={token}
                  target={{
                    kind: "ResourceQuota",
                    group: "",
                    resource: "resourcequotas",
                    apiVersion: "v1",
                    namespace,
                    name: resourceQuotaName || "",
                  }}
                  onApplied={refresh}
                />
              ) : null}
            </Box>
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={token}
              namespaceName={drawerNamespace}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
