import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiGet, toApiError, type ApiError } from "../api";
import { useConnectionState } from "../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../utils/format";
import Section from "./shared/Section";
import MetadataSection from "./shared/MetadataSection";
import EventsList from "./shared/EventsList";
import CodeBlock from "./shared/CodeBlock";
import KeyValueTable from "./shared/KeyValueTable";
import AccessDeniedState from "./shared/AccessDeniedState";
import EmptyState from "./shared/EmptyState";
import ErrorState from "./shared/ErrorState";
import ServiceAccountActions from "./ServiceAccountActions";
import RightDrawer from "./layout/RightDrawer";

type ServiceAccountDetails = {
  summary: ServiceAccountSummary;
  metadata: ServiceAccountMetadata;
  yaml: string;
};

type ServiceAccountSummary = {
  name: string;
  namespace: string;
  imagePullSecretsCount: number;
  secretsCount: number;
  automountServiceAccountToken?: boolean;
  createdAt?: number;
  ageSec?: number;
};

type ServiceAccountMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type RoleBindingListItem = {
  name: string;
  namespace: string;
  roleRefKind: string;
  roleRefName: string;
  subjectsCount: number;
  ageSec: number;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

function formatBool(val?: boolean) {
  if (val === undefined || val === null) return "-";
  return val ? "Yes" : "No";
}

function formatRoleRef(kind?: string, name?: string) {
  const k = kind || "-";
  const n = name || "-";
  return `${k}/${n}`;
}

export default function ServiceAccountDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  serviceAccountName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ServiceAccountDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [roleBindings, setRoleBindings] = useState<RoleBindingListItem[]>([]);
  const [roleBindingsLoading, setRoleBindingsLoading] = useState(false);
  const [roleBindingsLoaded, setRoleBindingsLoaded] = useState(false);
  const [roleBindingsErr, setRoleBindingsErr] = useState<ApiError | null>(null);

  const ns = props.namespace;
  const name = props.serviceAccountName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr(null);
    setDetails(null);
    setEvents([]);
    setRoleBindings([]);
    setRoleBindingsLoading(false);
    setRoleBindingsLoaded(false);
    setRoleBindingsErr(null);
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/serviceaccounts/${encodeURIComponent(name)}`,
        props.token
      );
      const item: ServiceAccountDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/serviceaccounts/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(toApiError(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  useEffect(() => {
    if (!props.open || !name || tab !== 1) return;
    if (roleBindingsLoading || roleBindingsLoaded) return;

    setRoleBindingsLoading(true);
    setRoleBindingsErr(null);

    apiGet<any>(
      `/api/namespaces/${encodeURIComponent(ns)}/serviceaccounts/${encodeURIComponent(name)}/rolebindings`,
      props.token
    )
      .then((res) => {
        const items: RoleBindingListItem[] = res?.items || [];
        setRoleBindings(items);
      })
      .catch((e) => setRoleBindingsErr(toApiError(e)))
      .finally(() => {
        setRoleBindingsLoading(false);
        setRoleBindingsLoaded(true);
      });
  }, [props.open, name, ns, props.token, tab, roleBindingsLoading, roleBindingsLoaded]);

  const summary = details?.summary;
  const metadata = details?.metadata;
  const accessDenied = err?.status === 401 || err?.status === 403;
  const roleBindingsAccessDenied = roleBindingsErr?.status === 401 || roleBindingsErr?.status === 403;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "ImagePullSecrets", value: valueOrDash(summary?.imagePullSecretsCount) },
      { label: "Secrets", value: valueOrDash(summary?.secretsCount) },
      { label: "Automount Token", value: formatBool(summary?.automountServiceAccountToken) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            ServiceAccount: {name || "-"}{" "}
            <Typography component="span" variant="body2">
              ({ns})
            </Typography>
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
          <AccessDeniedState status={err?.status} resourceLabel="Service Accounts" />
        ) : err ? (
          <ErrorState message={err.message} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Role Bindings" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <ServiceAccountActions
                        token={props.token}
                        namespace={ns}
                        serviceAccountName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />
                </Box>
              )}

              {/* ROLE BINDINGS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {roleBindingsLoading ? (
                    <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
                      <CircularProgress size={20} />
                    </Box>
                  ) : roleBindingsErr ? (
                    roleBindingsAccessDenied ? (
                      <AccessDeniedState status={roleBindingsErr?.status} resourceLabel="Role Bindings" />
                    ) : (
                      <ErrorState message={roleBindingsErr.message} />
                    )
                  ) : roleBindings.length === 0 ? (
                    <EmptyState message="No RoleBindings reference this ServiceAccount." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Role Ref</TableCell>
                          <TableCell>Subjects</TableCell>
                          <TableCell>Age</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {roleBindings.map((rb) => (
                          <TableRow key={rb.name}>
                            <TableCell>{valueOrDash(rb.name)}</TableCell>
                            <TableCell>{formatRoleRef(rb.roleRefKind, rb.roleRefName)}</TableCell>
                            <TableCell>{valueOrDash(rb.subjectsCount)}</TableCell>
                            <TableCell>{fmtAge(rb.ageSec, "table")}</TableCell>
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
                  <EventsList events={events} emptyMessage="No events found for this ServiceAccount." />
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
    </RightDrawer>
  );
}
