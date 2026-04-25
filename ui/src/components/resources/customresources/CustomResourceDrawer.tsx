import React, { useEffect, useMemo, useState } from "react";
import { Box, CircularProgress, Tabs, Tab } from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../../../utils/format";
import Section from "../../shared/Section";
import KeyValueTable from "../../shared/KeyValueTable";
import ErrorState from "../../shared/ErrorState";
import MetadataSection from "../../shared/MetadataSection";
import ConditionsTable from "../../shared/ConditionsTable";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import type { ApiItemResponse } from "../../../types/api";
import {
  panelBoxSx,
  drawerBodySx,
  drawerTabContentSx,
  loadingCenterSx,
} from "../../../theme/sxTokens";

type CRCondition = {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type CRSummary = {
  name: string;
  namespace?: string;
  group: string;
  version: string;
  kind: string;
  ageSec: number;
  createdAt: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type CRDetails = {
  summary: CRSummary;
  conditions?: CRCondition[];
  yaml: string;
};

export type CRRef = {
  group: string;
  version: string;
  /** Plural resource name (e.g. "certificates"). Optional — resolved lazily when absent. */
  resource?: string;
  kind: string;
  namespace: string; // "" for cluster-scoped
  name: string;
};

type ResolveResult = { resource: string; storageVersion: string };

export default function CustomResourceDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  crRef: CRRef | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CRDetails | null>(null);
  const [err, setErr] = useState("");
  // Resolved plural resource name — populated either directly from ref.resource
  // or via /api/customresources/resolve when resource is absent.
  const [resolvedResource, setResolvedResource] = useState<string | null>(null);
  const [resolvedVersion, setResolvedVersion] = useState<string | null>(null);

  const ref = props.crRef;
  const refKey = ref
    ? `${ref.group}|${ref.version}|${ref.resource ?? ""}|${ref.kind}|${ref.namespace}|${ref.name}`
    : "";

  // Reset tab only when the displayed resource identity changes.
  useEffect(() => {
    if (props.open && refKey) setTab(0);
  }, [props.open, refKey]);

  // Resolve resource (plural) if not already known.
  useEffect(() => {
    if (!props.open || !ref) return;

    if (ref.resource) {
      setResolvedResource(ref.resource);
      setResolvedVersion(ref.version);
      return;
    }

    setResolvedResource(null);
    setResolvedVersion(null);
    setErr("");
    setLoading(true);

    const path = `/api/customresources/resolve?group=${encodeURIComponent(ref.group)}&kind=${encodeURIComponent(ref.kind)}`;
    apiGet<ResolveResult>(path, props.token)
      .then((res) => {
        setResolvedResource(res.resource);
        setResolvedVersion(res.storageVersion || ref.version);
      })
      .catch((e) => {
        setErr(`Could not resolve CRD for ${ref.kind} (${ref.group}): ${String(e)}`);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, refKey, props.token, retryNonce]);

  // Fetch detail once resource is resolved.
  useEffect(() => {
    if (!props.open || !ref || !resolvedResource) return;

    setErr("");
    setDetails(null);
    setLoading(true);

    const version = resolvedVersion || ref.version;
    const params = ref.namespace ? `?namespace=${encodeURIComponent(ref.namespace)}` : "";
    const path = `/api/customresources/${encodeURIComponent(ref.group)}/${encodeURIComponent(version)}/${encodeURIComponent(resolvedResource)}/${encodeURIComponent(ref.name)}${params}`;

    apiGet<ApiItemResponse<CRDetails>>(path, props.token)
      .then((res) => setDetails(res?.item ?? null))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, refKey, resolvedResource, resolvedVersion, props.token]);

  const summary = details?.summary;
  const conditions = details?.conditions || [];

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      ...(summary?.namespace ? [{ label: "Namespace", value: summary.namespace, monospace: true }] : []),
      { label: "Kind", value: valueOrDash(ref?.kind) },
      { label: "Group", value: valueOrDash(ref?.group), monospace: true },
      { label: "Version", value: valueOrDash(resolvedVersion || ref?.version), monospace: true },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary, ref, resolvedVersion],
  );

  const title = ref
    ? `${ref.kind}: ${ref.name}${ref.namespace ? ` (${ref.namespace})` : ""}`
    : "-";

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell title={title} onClose={props.onClose}>
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
              <Tab label="Conditions" />
              <Tab label="Metadata" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  <Section title="Summary">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable rows={summaryItems} columns={2} />
                    </Box>
                  </Section>
                  <ConditionsTable
                    conditions={conditions}
                    variant="section"
                    title="Conditions"
                    emptyMessage="No status conditions reported."
                    unhealthyFirst
                  />
                </Box>
              )}

              {/* CONDITIONS */}
              {tab === 1 && (
                <Box sx={drawerTabContentSx}>
                  <ConditionsTable
                    conditions={conditions}
                    variant="section"
                    title="Conditions"
                    emptyMessage="No status conditions reported."
                    unhealthyFirst
                  />
                </Box>
              )}

              {/* METADATA */}
              {tab === 2 && (
                <Box sx={drawerTabContentSx}>
                  <MetadataSection labels={summary?.labels} annotations={summary?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 3 && ref && resolvedResource && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: ref.kind,
                    group: ref.group,
                    resource: resolvedResource,
                    apiVersion: ref.group ? `${ref.group}/${resolvedVersion || ref.version}` : (resolvedVersion || ref.version),
                    name: ref.name,
                    namespace: ref.namespace || undefined,
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
