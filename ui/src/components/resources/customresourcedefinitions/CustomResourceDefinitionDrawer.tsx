import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AttentionSummary from "../../shared/AttentionSummary";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import EventsList from "../../shared/EventsList";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import CRDActions from "./CRDActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type CRDDetails = {
  summary: CRDSummary;
  versions: CRDVersion[];
  conditions: CRDCondition[];
  metadata: CRDMetadata;
  yaml: string;
};

type CRDSummary = {
  name: string;
  group?: string;
  scope?: string;
  kind?: string;
  plural?: string;
  singular?: string;
  shortNames?: string[];
  categories?: string[];
  conversionStrategy?: string;
  established?: boolean;
  ageSec?: number;
  createdAt?: number;
};

type CRDVersion = {
  name: string;
  served: boolean;
  storage: boolean;
  deprecated: boolean;
  deprecationWarning?: string;
};

type CRDCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type CRDMetadata = {
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

export default function CustomResourceDefinitionDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  crdName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CRDDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");

  const name = props.crdName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<CRDDetails>>(`/api/customresourcedefinitions/${encodeURIComponent(name)}`, props.token);
      const item: CRDDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(`/api/customresourcedefinitions/${encodeURIComponent(name)}/events`, props.token);
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const versions = details?.versions || [];
  const conditions = details?.conditions || [];
  const metadata = details?.metadata;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "cluster",
    kind: "customresourcedefinitions",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce,
  });

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Group", value: valueOrDash(summary?.group), monospace: true },
      { label: "Scope", value: valueOrDash(summary?.scope) },
      { label: "Kind", value: valueOrDash(summary?.kind) },
      { label: "Plural", value: valueOrDash(summary?.plural), monospace: true },
      { label: "Singular", value: valueOrDash(summary?.singular), monospace: true },
      {
        label: "Short Names",
        value: summary?.shortNames?.length ? summary.shortNames.join(", ") : "-",
        monospace: true,
      },
      {
        label: "Categories",
        value: summary?.categories?.length ? summary.categories.join(", ") : "-",
      },
      {
        label: "Conversion",
        value: valueOrDash(summary?.conversionStrategy),
      },
      {
        label: "Established",
        value: (
          <Chip
            size="small"
            label={summary?.established ? "Yes" : "No"}
            color={summary?.established ? "success" : "warning"}
          />
        ),
      },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary],
  );
  const crdSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell title={<>CRD: {name || "-"}</>} onClose={props.onClose}>
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
              <Tab label="Versions" />
              <Tab label="Events" />
              <Tab label="Metadata" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <CRDActions
                        token={props.token}
                        crdName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={crdSignals}
                    onJumpToEvents={() => setTab(2)}
                  />

                  <ConditionsTable
                    conditions={conditions}
                    variant="section"
                    title="Conditions"
                    emptyMessage="No conditions reported for this CRD."
                    unhealthyFirst
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* VERSIONS */}
              {tab === 1 && (
                <Box sx={drawerTabContentSx}>
                  {versions.length === 0 ? (
                    <EmptyState message="No versions defined for this CRD." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Served</TableCell>
                          <TableCell>Storage</TableCell>
                          <TableCell>Deprecated</TableCell>
                          <TableCell>Deprecation Warning</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {versions.map((v, idx) => (
                          <TableRow key={`${v.name}-${idx}`}>
                            <TableCell sx={{ fontFamily: "monospace" }}>{valueOrDash(v.name)}</TableCell>
                            <TableCell>
                              <Chip size="small" label={v.served ? "Yes" : "No"} color={v.served ? "success" : "default"} />
                            </TableCell>
                            <TableCell>
                              <Chip size="small" label={v.storage ? "Yes" : "No"} color={v.storage ? "info" : "default"} />
                            </TableCell>
                            <TableCell>
                              {v.deprecated ? (
                                <Chip size="small" label="Deprecated" color="warning" />
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "pre-wrap" }}>{valueOrDash(v.deprecationWarning)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this CRD." />
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
                    kind: "CustomResourceDefinition",
                    group: "apiextensions.k8s.io",
                    resource: "customresourcedefinitions",
                    apiVersion: "apiextensions.k8s.io/v1",
                    name: name || "",
                  }}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
