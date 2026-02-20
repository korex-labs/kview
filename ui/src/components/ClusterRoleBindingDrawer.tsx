import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Drawer,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiGet, toApiError, type ApiError } from "../api";
import { useConnectionState } from "../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../utils/format";
import KeyValueTable from "./shared/KeyValueTable";
import AccessDeniedState from "./shared/AccessDeniedState";
import EmptyState from "./shared/EmptyState";
import ErrorState from "./shared/ErrorState";
import EventsList from "./shared/EventsList";
import CodeBlock from "./shared/CodeBlock";
import Section from "./shared/Section";
import ClusterRoleDrawer from "./ClusterRoleDrawer";
import ClusterRoleBindingActions from "./ClusterRoleBindingActions";

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
      const det = await apiGet<any>(`/api/clusterrolebindings/${encodeURIComponent(name)}`, props.token);
      const item: ClusterRoleBindingDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(`/api/clusterrolebindings/${encodeURIComponent(name)}/events`, props.token);
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(toApiError(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const roleRef = details?.roleRef;
  const subjects = details?.subjects || [];
  const accessDenied = err?.status === 401 || err?.status === 403;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );

  function openRoleRef() {
    if (!roleRef?.kind || !roleRef?.name) return;
    if (roleRef.kind === "ClusterRole") {
      setDrawerClusterRole(roleRef.name);
    }
  }

  const canOpenRoleRef = roleRef?.kind === "ClusterRole";

  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      PaperProps={{
        sx: {
          mt: 8,
          height: "calc(100% - 64px)",
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
        },
      }}
    >
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            ClusterRoleBinding: {name || "-"}
          </Typography>
          <IconButton onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ my: 1 }} />

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
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
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
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

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
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
                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
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

              {/* YAML */}
              {tab === 4 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
          </>
        )}
      </Box>

      <ClusterRoleDrawer
        open={!!drawerClusterRole}
        onClose={() => setDrawerClusterRole(null)}
        token={props.token}
        clusterRoleName={drawerClusterRole}
      />
    </Drawer>
  );
}
