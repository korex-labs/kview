import React, { useEffect, useMemo, useState } from "react";
import { Box, Chip, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Tab } from "@mui/material";
import { useConnectionState } from "../../../connectionState";
import type { NetworkPolicyDetails, NetworkPolicyRule } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { fetchNamespacedResourceDetailWithWarnings, type ResourceWarningEvent } from "../../../utils/resourceDrawerFetch";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import EmptyState from "../../shared/EmptyState";
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
import { drawerBodySx, drawerTabContentSx, loadingCenterSx, panelBoxSx } from "../../../theme/sxTokens";
import NetworkPolicyActions from "./NetworkPolicyActions";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";

const tabs = ["Overview", "Rules", "Events", "Metadata", "YAML"];

function renderList(items?: string[]): string {
  return items?.length ? items.join(", ") : "all";
}

function RulesTable({ rules, emptyMessage }: { rules?: NetworkPolicyRule[]; emptyMessage: string }) {
  if (!rules || rules.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Peers</TableCell>
          <TableCell>Ports</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rules.map((rule, index) => (
          <TableRow key={index}>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{renderList(rule.peers)}</TableCell>
            <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{renderList(rule.ports)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function NetworkPolicyDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  networkPolicyName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<NetworkPolicyDetails | null>(null);
  const [events, setEvents] = useState<ResourceWarningEvent[]>([]);
  const [err, setErr] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.networkPolicyName;

  useEffect(() => {
    if (!props.open || !name) return;
    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setDrawerNamespace(null);
    setLoading(true);
    fetchNamespacedResourceDetailWithWarnings<NetworkPolicyDetails>({
      token: props.token,
      namespace: ns,
      resource: "networkpolicies",
      name,
    })
      .then((res) => {
        setDetails(res.item);
        setEvents(res.warningEvents);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const summaryRows = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Namespace",
        value: summary?.namespace ? <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} /> : "-",
      },
      { label: "Pod selector", value: valueOrDash(summary?.podSelector), monospace: true },
      { label: "Policy types", value: summary?.policyTypes?.join(", ") || "-" },
      { label: "Ingress rules", value: valueOrDash(summary?.ingressRules) },
      { label: "Egress rules", value: valueOrDash(summary?.egressRules) },
      { label: "Selected pods", value: valueOrDash(summary?.selectedPods) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
    ],
    [summary],
  );
  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        resourceIcon="networkpolicies"
        title={`NetworkPolicy: ${name || "-"}`}
        onClose={props.onClose}
      >
        {loading ? (
          <Box sx={loadingCenterSx}><CircularProgress /></Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              {tabs.map((label) => (
                <Tab key={label} icon={<DetailTabIcon label={label} />} iconPosition="start" label={label} />
              ))}
            </Tabs>
            <Box sx={drawerBodySx}>
              {tab === 0 ? (
                <Box sx={drawerTabContentSx}>
                  <DrawerActionStrip>
                    {(summary?.policyTypes || []).map((type) => <Chip key={type} size="small" label={type} />)}
                    {name ? (
                      <NetworkPolicyActions
                        token={props.token}
                        namespace={ns}
                        networkPolicyName={name}
                        onDeleted={props.onClose}
                      />
                    ) : null}
                  </DrawerActionStrip>
                  <Section title="Summary">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable rows={summaryRows} columns={2} />
                    </Box>
                  </Section>
                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              ) : null}
              {tab === 1 ? (
                <Box sx={drawerTabContentSx}>
                  <Section title="Ingress">
                    <Box sx={panelBoxSx}>
                      <RulesTable rules={details?.ingress} emptyMessage="No ingress rules configured." />
                    </Box>
                  </Section>
                  <Section title="Egress">
                    <Box sx={panelBoxSx}>
                      <RulesTable rules={details?.egress} emptyMessage="No egress rules configured." />
                    </Box>
                  </Section>
                </Box>
              ) : null}
              {tab === 2 ? (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel
                    endpoint={`/api/namespaces/${encodeURIComponent(ns)}/networkpolicies/${encodeURIComponent(name || "")}/events`}
                    token={props.token}
                    emptyMessage="No events found for this NetworkPolicy."
                  />
                </Box>
              ) : null}
              {tab === 3 ? (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryRows} columns={3} />
                  </Box>
                  <MetadataSection labels={details?.metadata?.labels} annotations={details?.metadata?.annotations} />
                </Box>
              ) : null}
              {tab === 4 ? (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "NetworkPolicy",
                    group: "networking.k8s.io",
                    resource: "networkpolicies",
                    apiVersion: "networking.k8s.io/v1",
                    namespace: ns,
                    name: name || "",
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
                />
              ) : null}
            </Box>
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
