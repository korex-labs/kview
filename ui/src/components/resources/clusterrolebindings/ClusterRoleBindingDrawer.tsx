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
  Button,
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
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import Section from "../../shared/Section";
import ClusterRoleDrawer from "../clusterroles/ClusterRoleDrawer";
import ClusterRoleBindingActions from "./ClusterRoleBindingActions";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse, ApiListResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import { panelBoxSx, drawerBodySx, drawerTabContentSx, loadingCenterSx } from "../../../theme/sxTokens";

type ClusterRoleBindingDetails = {
  summary: BindingSummary;
  roleRef: RoleRef;
  subjects: Subject[];
  yaml: string;
};

type BindingSummary = {
  name: string;
  createdAt?: number;
  ageSec?: number;
};

type RoleRef = {
  kind: string;
  name: string;
  apiGroup: string;
};

type Subject = {
  kind: string;
  name: string;
  namespace?: string;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

export default function ClusterRoleBindingDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  clusterRoleBindingName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ClusterRoleBindingDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [drawerClusterRole, setDrawerClusterRole] = useState<string | null>(null);

  const name = props.clusterRoleBindingName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr(null);
    setDetails(null);
    setEvents([]);
    setDrawerClusterRole(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<ApiItemResponse<ClusterRoleBindingDetails>>(`/api/clusterrolebindings/${encodeURIComponent(name)}`, props.token);
      const item: ClusterRoleBindingDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<ApiListResponse<EventDTO>>(`/api/clusterrolebindings/${encodeURIComponent(name)}/events`, props.token);
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(toApiError(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const roleRef = details?.roleRef;
  const subjects = details?.subjects || [];
  const accessDenied = err?.status === 401 || err?.status === 403;
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "cluster",
    kind: "clusterrolebindings",
    name: name || "",
    enabled: !!props.open && !!name && !accessDenied,
    refreshKey: retryNonce,
  });

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );
  const clusterRoleBindingSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  const warningEvents = useMemo(
    () => events.filter((e) => String(e.type).toLowerCase() === "warning").slice(0, 5),
    [events],
  );

  function openRoleRef() {
    if (!roleRef?.kind || !roleRef?.name) return;
    if (roleRef.kind === "ClusterRole") {
      setDrawerClusterRole(roleRef.name);
    }
  }

  const canOpenRoleRef = roleRef?.kind === "ClusterRole";

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell title={<>ClusterRoleBinding: {name || "-"}</>} onClose={props.onClose}>
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : accessDenied ? (
          <AccessDeniedState status={err?.status} resourceLabel="Cluster Role Bindings" />
        ) : err ? (
          <ErrorState message={err.message} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Subjects" />
              <Tab label="Role Ref" />
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
                      <ClusterRoleBindingActions
                        token={props.token}
                        clusterRoleBindingName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <AttentionSummary
                    signals={clusterRoleBindingSignals}
                    onJumpToEvents={() => setTab(3)}
                  />

                  <Section title="Recent Warning events">
                    <Box sx={panelBoxSx}>
                      <EventsList events={warningEvents} emptyMessage="No recent warning events." />
                    </Box>
                  </Section>
                </Box>
              )}

              {/* SUBJECTS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {subjects.length === 0 ? (
                    <EmptyState message="No subjects defined for this ClusterRoleBinding." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Kind</TableCell>
                          <TableCell>Name</TableCell>
                          <TableCell>Namespace</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {subjects.map((s, idx) => (
                          <TableRow key={`${s.kind || "subject"}-${s.name || idx}`}>
                            <TableCell>{valueOrDash(s.kind)}</TableCell>
                            <TableCell>{valueOrDash(s.name)}</TableCell>
                            <TableCell>{valueOrDash(s.namespace)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* ROLE REF */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable
                      rows={[
                        { label: "Kind", value: valueOrDash(roleRef?.kind) },
                        { label: "Name", value: valueOrDash(roleRef?.name), monospace: true },
                        { label: "API Group", value: valueOrDash(roleRef?.apiGroup) },
                      ]}
                      columns={3}
                    />
                  </Box>
                  <Box>
                    <Button variant="outlined" onClick={openRoleRef} disabled={!canOpenRoleRef}>
                      Open Role Ref
                    </Button>
                  </Box>
                </Box>
              )}

              {/* EVENTS */}
              {tab === 3 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this ClusterRoleBinding." />
                </Box>
              )}

              {/* METADATA */}
              {tab === 4 && (
                <Box sx={drawerTabContentSx}>
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: "ClusterRoleBinding",
                    group: "rbac.authorization.k8s.io",
                    resource: "clusterrolebindings",
                    apiVersion: "rbac.authorization.k8s.io/v1",
                    name: name || "",
                  }}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>

      <ClusterRoleDrawer
        open={!!drawerClusterRole}
        onClose={() => setDrawerClusterRole(null)}
        token={props.token}
        clusterRoleName={drawerClusterRole}
      />
    </RightDrawer>
  );
}
