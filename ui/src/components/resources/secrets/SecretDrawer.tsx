import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import { detectLanguageFromKey } from "../../../utils/syntaxDetect";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import CodeBlock from "../../shared/CodeBlock";
import SecretActions from "./SecretActions";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type SecretDetails = {
  summary: SecretSummary;
  keys?: SecretKey[];
  keyNames: string[];
  metadata: SecretMetadata;
  yaml?: string;
};

type SecretKey = {
  name: string;
  value: string;
  sizeBytes: number;
};

type SecretSummary = {
  name: string;
  namespace: string;
  type: string;
  immutable?: boolean;
  keysCount: number;
  createdAt?: number;
  ageSec?: number;
};

type SecretMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

function formatImmutable(val?: boolean) {
  if (val === undefined || val === null) return "-";
  return val ? "Yes" : "No";
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export default function SecretDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  secretName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<SecretDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.secretName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setExpandedKeys({});
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<SecretDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}`,
        props.token
      );
      const item: SecretDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name)}/events?limit=5&type=Warning`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "secrets",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Type", value: valueOrDash(summary?.type), monospace: true },
      { label: "Keys", value: valueOrDash(summary?.keysCount) },
      { label: "Immutable", value: formatImmutable(summary?.immutable) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );

  const keys = details?.keys || [];
  const hasKeys = keys.length > 0;
  const secretSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="secrets"
        title={
          <>
            Secret: {name || "-"}{" "}
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
              <Tab icon={<DetailTabIcon label="Keys" />} iconPosition="start" label="Keys" />
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
                      <SecretActions
                        token={props.token}
                        namespace={ns}
                        secretName={name}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={secretSignals}
                    onJumpToEvents={() => setTab(2)}
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* KEYS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {!hasKeys ? (
                    <EmptyState message="No keys found for this Secret." />
                  ) : (
                    keys.map((k, idx) => {
                      const keyId = k.name || String(idx);
                      const lang = detectLanguageFromKey(k.name);

                      return (
                        <Accordion
                          key={keyId}
                          expanded={!!expandedKeys[keyId]}
                          onChange={() =>
                            setExpandedKeys((prev) => ({
                              ...prev,
                              [keyId]: !prev[keyId],
                            }))
                          }
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flexGrow: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontFamily: "monospace" }}>
                                {valueOrDash(k.name)}
                              </Typography>
                              {k.sizeBytes !== undefined && <Chip size="small" label={formatBytes(k.sizeBytes)} />}
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails>
                            <CodeBlock code={k.value} language={lang} showCopy />
                          </AccordionDetails>
                        </Accordion>
                      );
                    })
                  )}
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/secrets/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this Secret." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
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
                    kind: "Secret",
                    group: "",
                    resource: "secrets",
                    apiVersion: "v1",
                    namespace: ns,
                    name: name || "",
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>
      <NamespaceDrawer
        open={!!drawerNamespace}
        onClose={() => setDrawerNamespace(null)}
        token={props.token}
        namespaceName={drawerNamespace}
      />
    </RightDrawer>
  );
}
