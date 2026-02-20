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
import ClusterRoleActions from "./ClusterRoleActions";

type ClusterRoleDetails = {
  summary: ClusterRoleSummary;
  rules: PolicyRule[];
  yaml: string;
};

type ClusterRoleSummary = {
  name: string;
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

export default function ClusterRoleDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  clusterRoleName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ClusterRoleDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);

  const name = props.clusterRoleName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr(null);
    setDetails(null);
    setEvents([]);
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(`/api/clusterroles/${encodeURIComponent(name)}`, props.token);
      const item: ClusterRoleDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(`/api/clusterroles/${encodeURIComponent(name)}/events`, props.token);
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(toApiError(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, props.token, retryNonce]);

  const summary = details?.summary;
  const rules = details?.rules || [];
  const accessDenied = err?.status === 401 || err?.status === 403;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Rules", value: valueOrDash(summary?.rulesCount) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );

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
            ClusterRole: {name || "-"}
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
          <AccessDeniedState status={err?.status} resourceLabel="Cluster Roles" />
        ) : err ? (
          <ErrorState message={err.message} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Rules" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <ClusterRoleActions
                        token={props.token}
                        clusterRoleName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                </Box>
              )}

              {/* RULES */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {rules.length === 0 ? (
                    <EmptyState message="No rules defined for this ClusterRole." />
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
                  <EventsList events={events} emptyMessage="No events found for this ClusterRole." />
                </Box>
              )}

              {/* YAML */}
              {tab === 3 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}
