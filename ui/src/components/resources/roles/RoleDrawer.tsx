import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Tabs,
  Tab,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
} from "@mui/material";
import { apiGet, toApiError, type ApiError } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import KeyValueTable from "../../shared/KeyValueTable";
import AccessDeniedState from "../../shared/AccessDeniedState";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import AttentionSummary from "../../shared/AttentionSummary";
import EventsList from "../../shared/EventsList";
import EventsPanel from "../../shared/EventsPanel";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import RoleActions from "./RoleActions";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type RoleDetails = {
  summary: RoleSummary;
  rules: PolicyRule[];
  yaml: string;
};

type RoleSummary = {
  name: string;
  namespace: string;
  rulesCount: number;
  createdAt?: number;
  ageSec?: number;
};

type PolicyRule = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
  resourceNames?: string[];
  nonResourceURLs?: string[];
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

function formatRuleValues(values?: string[]) {
  if (!values || values.length === 0) return "-";
  return values.join(", ");
}

export default function RoleDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  roleName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<RoleDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.roleName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr(null);
    setDetails(null);
    setEvents([]);
    setDrawerNamespace(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<RoleDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/roles/${encodeURIComponent(name)}`,
        props.token
      );
      const item: RoleDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(
        `/api/namespaces/${encodeURIComponent(ns)}/roles/${encodeURIComponent(name)}/events?limit=5&type=Warning`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(toApiError(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const rules = details?.rules || [];
  const accessDenied = err?.status === 401 || err?.status === 403;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "roles",
    name: name || "",
    enabled: !!props.open && !!name && !accessDenied,
    refreshKey: retryNonce,
  });

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Rules", value: valueOrDash(summary?.rulesCount) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );
  const roleSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="roles"
        title={
          <>
            Role: {name || "-"}{" "}
            {ns ? <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} /> : null}
          </>
        }
        onClose={props.onClose}
      >
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : accessDenied ? (
          <AccessDeniedState status={err?.status} resourceLabel="Roles" />
        ) : err ? (
          <ErrorState message={err.message} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab icon={<DetailTabIcon label="Rules" />} iconPosition="start" label="Rules" />
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
                      <RoleActions
                        token={props.token}
                        namespace={ns}
                        roleName={name}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={roleSignals}
                    onJumpToEvents={() => setTab(2)}
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* RULES */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {rules.length === 0 ? (
                    <EmptyState message="No rules defined for this Role." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>API Groups</TableCell>
                          <TableCell>Resources</TableCell>
                          <TableCell>Verbs</TableCell>
                          <TableCell>Resource Names</TableCell>
                          <TableCell>Non-Resource URLs</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rules.map((r, idx) => (
                          <TableRow key={`${r.resources?.join(",") || "rule"}-${idx}`}>
                            <TableCell>{formatRuleValues(r.apiGroups)}</TableCell>
                            <TableCell>{formatRuleValues(r.resources)}</TableCell>
                            <TableCell>{formatRuleValues(r.verbs)}</TableCell>
                            <TableCell>{formatRuleValues(r.resourceNames)}</TableCell>
                            <TableCell>{formatRuleValues(r.nonResourceURLs)}</TableCell>
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
                  <EventsPanel endpoint={`/api/namespaces/${encodeURIComponent(ns)}/roles/${encodeURIComponent(name || "")}/events`} token={props.token} emptyMessage="No events found for this Role." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                </Box>
              )}

              {/* YAML */}
              {tab === 4 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "Role",
                    group: "rbac.authorization.k8s.io",
                    resource: "roles",
                    apiVersion: "rbac.authorization.k8s.io/v1",
                    namespace: ns,
                    name: name || "",
                  }}
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
