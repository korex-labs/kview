import React, { useEffect, useMemo, useState } from "react";
import { Box, CircularProgress, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs } from "@mui/material";
import { useConnectionState } from "../../../connectionState";
import type { LimitRangeDetails, LimitRangeItem } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { fetchNamespacedResourceDetailWithWarnings, type ResourceWarningEvent } from "../../../utils/resourceDrawerFetch";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import ErrorState from "../../shared/ErrorState";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
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
import LimitRangeActions from "./LimitRangeActions";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";

const tabs = ["Overview", "Events", "Metadata", "YAML"];
const tabActionIds = [
  "drawer.tab.overview", "drawer.tab.events", "drawer.tab.metadata", "drawer.tab.yaml",
] satisfies DrawerTabActionId[];

function mapSummary(values?: Record<string, string>): string {
  return Object.entries(values || {}).map(([key, value]) => `${key}=${value}`).join(", ") || "-";
}

function rowKey(item: LimitRangeItem, index: number): string {
  return `${item.type || "item"}-${index}`;
}

function LimitsTable({ items }: { items?: LimitRangeItem[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Type</TableCell>
          <TableCell>Min</TableCell>
          <TableCell>Max</TableCell>
          <TableCell>Default</TableCell>
          <TableCell>Default Request</TableCell>
          <TableCell>Max Ratio</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {(items || []).map((item, index) => (
          <TableRow key={rowKey(item, index)}>
            <TableCell>{valueOrDash(item.type)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{mapSummary(item.min)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{mapSummary(item.max)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{mapSummary(item.default)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{mapSummary(item.defaultRequest)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{mapSummary(item.maxLimitRequestRatio)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function LimitRangeDrawer({
  open,
  onClose,
  token,
  namespace,
  limitRangeName,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  limitRangeName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<LimitRangeDetails | null>(null);
  const [events, setEvents] = useState<ResourceWarningEvent[]>([]);
  const [err, setErr] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !limitRangeName) return;
    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerNamespace(null);
    setLoading(true);
    fetchNamespacedResourceDetailWithWarnings<LimitRangeDetails>({
      token,
      namespace,
      resource: "limitranges",
      name: limitRangeName,
    })
      .then((res) => {
        setDetails(res.item);
        setEvents(res.warningEvents);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [open, limitRangeName, namespace, token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const summaryRows = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Namespace",
        value: summary?.namespace ? <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} /> : "-",
      },
      { label: "Items", value: valueOrDash(summary?.items?.length) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary],
  );

  return (
    <RightDrawer open={open} onClose={onClose}>
      <ResourceDrawerShell
        resourceIcon="limitranges"
        title={`LimitRange: ${limitRangeName || "-"}`}
        resourceIdentity={{ resource: "limitranges", namespace, name: limitRangeName }}
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
                    {limitRangeName ? (
                      <LimitRangeActions
                        token={token}
                        namespace={namespace}
                        limitRangeName={limitRangeName}
                        onDeleted={onClose}
                      />
                    ) : null}
                  </DrawerActionStrip>
                  <Section title="Summary">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable rows={summaryRows} columns={2} />
                    </Box>
                  </Section>
                  <Section title="Limits">
                    <Box sx={panelBoxSx}>
                      <LimitsTable items={summary?.items} />
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
                    endpoint={`/api/namespaces/${encodeURIComponent(namespace)}/limitranges/${encodeURIComponent(limitRangeName || "")}/events`}
                    token={token}
                    emptyMessage="No events found for this LimitRange."
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
                    kind: "LimitRange",
                    group: "",
                    resource: "limitranges",
                    apiVersion: "v1",
                    namespace,
                    name: limitRangeName || "",
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
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
