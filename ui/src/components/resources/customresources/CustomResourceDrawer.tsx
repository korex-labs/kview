import React, { useEffect, useMemo, useState } from "react";
import { Box, Chip, CircularProgress, Tabs, Tab } from "@mui/material";
import { apiGet, toApiError } from "../../../api";
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
import DetailTabIcon from "../../shared/DetailTabIcon";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import { ResourceDrawerTags } from "../../shared/ResourceTags";
import { ResourceDrawerMacros } from "../../shared/ResourceMacros";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import type { ApiItemResponse } from "../../../types/api";
import type { ListResourceKey } from "../../../utils/k8sResources";
import CustomResourceStatusCell from "./CustomResourceStatusCell";
import CustomResourceActions from "./CustomResourceActions";
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
  signalSeverity?: string;
  statusSummary?: string;
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
  /** Namespace to use only when lazy CRD resolution reports Namespaced scope. */
  defaultNamespace?: string;
  name: string;
  provenance?: "kubernetes" | "helmManifest";
};

type ResolveResult = { resource: string; storageVersion: string; scope?: string };

export function resolvedCustomResourceNamespace(
  ref: Pick<CRRef, "namespace" | "defaultNamespace">,
  resolvedScope?: string | null,
): string {
  return ref.namespace || (resolvedScope === "Namespaced" ? ref.defaultNamespace || "" : "");
}

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
  const [errStatus, setErrStatus] = useState<number | undefined>();
  const [notFoundMessage, setNotFoundMessage] = useState<string | undefined>();
  const [namespaceDrawerOpen, setNamespaceDrawerOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Resolved plural resource name — populated either directly from ref.resource
  // or via /api/customresources/resolve when resource is absent.
  const [resolvedResource, setResolvedResource] = useState<string | null>(null);
  const [resolvedVersion, setResolvedVersion] = useState<string | null>(null);
  const [resolvedScope, setResolvedScope] = useState<string | null>(null);

  const ref = props.crRef;
  const refKey = ref
    ? `${ref.group}|${ref.version}|${ref.resource ?? ""}|${ref.kind}|${ref.namespace}|${ref.defaultNamespace ?? ""}|${ref.name}|${ref.provenance ?? ""}`
    : "";
  const unresolvedManifestReference = ref?.provenance === "helmManifest" && !resolvedResource && Boolean(err);

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
      setResolvedScope(ref.namespace ? "Namespaced" : "Cluster");
      return;
    }

    setResolvedResource(null);
    setResolvedVersion(null);
    setResolvedScope(null);
    setErr("");
    setErrStatus(undefined);
    setNotFoundMessage(undefined);
    setLoading(true);

    const path = `/api/customresources/resolve?group=${encodeURIComponent(ref.group)}&kind=${encodeURIComponent(ref.kind)}`;
    apiGet<ResolveResult>(path, props.token)
      .then((res) => {
        setResolvedResource(res.resource);
        setResolvedVersion(res.storageVersion || ref.version);
        setResolvedScope(res.scope || null);
      })
      .catch((e) => {
        const apiError = toApiError(e);
        setErr(`Could not resolve CRD for ${ref.kind} (${ref.group}): ${apiError.message}`);
        setErrStatus(apiError.status);
        if (apiError.status === 404) {
          setNotFoundMessage("CRD metadata for this manifest reference is not available in the active context. The row does not confirm that a live custom resource exists.");
        }
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
    const effectiveNamespace = resolvedCustomResourceNamespace(ref, resolvedScope);
    const params = effectiveNamespace ? `?namespace=${encodeURIComponent(effectiveNamespace)}` : "";
    const path = `/api/customresources/${encodeURIComponent(ref.group)}/${encodeURIComponent(version)}/${encodeURIComponent(resolvedResource)}/${encodeURIComponent(ref.name)}${params}`;

    apiGet<ApiItemResponse<CRDetails>>(path, props.token)
      .then((res) => setDetails(res?.item ?? null))
      .catch((e) => {
        const apiError = toApiError(e);
        setErr(apiError.message);
        setErrStatus(apiError.status);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, refKey, resolvedResource, resolvedVersion, resolvedScope, props.token, refreshNonce]);

  const summary = details?.summary;
  const drawerNamespace = ref ? resolvedCustomResourceNamespace(ref, resolvedScope) : "";
  const drawerResourceKey: ListResourceKey = drawerNamespace ? "customresources" : "clusterresources";
  const labels = summary?.labels;
  const annotations = summary?.annotations;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      ...(summary?.namespace ? [{
        label: "Namespace",
        value: (
          <Chip
            size="small"
            label={summary.namespace}
            variant="outlined"
            onClick={() => setNamespaceDrawerOpen(true)}
            sx={{ fontFamily: "monospace" }}
          />
        ),
      }] : []),
      { label: "Kind", value: valueOrDash(ref?.kind) },
      { label: "Group", value: valueOrDash(ref?.group), monospace: true },
      { label: "Version", value: valueOrDash(resolvedVersion || ref?.version), monospace: true },
      {
        label: "Status",
        value: <CustomResourceStatusCell severity={summary?.signalSeverity} summary={summary?.statusSummary} />,
      },
      { label: "Reason", value: valueOrDash(summary?.statusSummary) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary, ref, resolvedVersion],
  );

  const title = ref ? (
    <>
      {ref.kind}: {ref.name || "-"}{" "}
      {drawerNamespace ? <ResourceLinkChip label={drawerNamespace} onClick={() => setNamespaceDrawerOpen(true)} /> : null}
    </>
  ) : "-";

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell
        token={props.token}
        resourceIcon="customresources"
        title={title}
        onClose={props.onClose}
        headerMeta={
          ref ? <ResourceDrawerTags resource={drawerResourceKey} namespace={drawerNamespace} name={ref.name} labels={labels} annotations={annotations} /> : null
        }
        dynamicLinks={ref && !unresolvedManifestReference ? {
          resource: drawerResourceKey,
          namespace: drawerNamespace,
          name: ref.name,
          labels,
          annotations,
          ...(resolvedResource ? {
            group: ref.group,
            version: resolvedVersion || ref.version,
            apiResource: resolvedResource,
            kind: ref.kind,
            scope: drawerNamespace ? "namespaced" as const : "cluster" as const,
          } : {}),
        } : undefined}
        headerActions={ref && !unresolvedManifestReference ? (
          <>
            <ResourceDrawerMacros
              resource={drawerResourceKey}
              namespace={drawerNamespace}
              name={ref.name}
              labels={labels}
              annotations={annotations}
            />
            <ResourceDrawerTags resource={drawerResourceKey} namespace={drawerNamespace} name={ref.name} labels={labels} annotations={annotations} mode="edit" />
          </>
        ) : undefined}
      >
        {loading ? (
          <Box sx={loadingCenterSx}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} status={errStatus} notFoundMessage={notFoundMessage} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab data-keyboard-action-id="drawer.tab.overview" icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab data-keyboard-action-id="drawer.tab.metadata" icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab data-keyboard-action-id="drawer.tab.yaml" icon={<DetailTabIcon label="YAML" />} iconPosition="start" label="YAML" />
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={drawerTabContentSx}>
                  {ref && resolvedResource ? (
                    <DrawerActionStrip>
                      <CustomResourceActions
                        token={props.token}
                        namespace={drawerNamespace}
                        name={ref.name}
                        group={ref.group}
                        version={resolvedVersion || ref.version}
                        resource={resolvedResource}
                        kind={ref.kind}
                        onDeleted={props.onClose}
                      />
                    </DrawerActionStrip>
                  ) : null}
                  <Section title="Summary">
                    <Box sx={panelBoxSx}>
                      <KeyValueTable rows={summaryItems} columns={2} />
                    </Box>
                  </Section>
                  {/* Raw conditions have controller-specific polarity and no freshness
                      metadata in this DTO. Only the server-derived summary is a
                      health verdict; do not color arbitrary True values healthy. */}
                  <ConditionsTable
                    conditions={details?.conditions || []}
                    isHealthy={() => true}
                    chipColor={() => "default"}
                    unhealthyFirst={false}
                    variant="section"
                    title="Conditions"
                    emptyMessage="No conditions reported for this custom resource."
                  />
                </Box>
              )}

              {/* CONDITIONS */}
              {tab === 1 && (
                <Box sx={drawerTabContentSx}>
                  <MetadataSection labels={summary?.labels} annotations={summary?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 2 && ref && resolvedResource && (
                <ResourceYamlPanel
                  code={details?.yaml || ""}
                  token={props.token}
                  target={{
                    kind: ref.kind,
                    group: ref.group,
                    resource: resolvedResource,
                    apiVersion: ref.group ? `${ref.group}/${resolvedVersion || ref.version}` : (resolvedVersion || ref.version),
                    name: ref.name,
                    namespace: drawerNamespace || undefined,
                  }}
                  onApplied={() => setRefreshNonce((v) => v + 1)}
                />
              )}
            </Box>
          </>
        )}
      </ResourceDrawerShell>
      <NamespaceDrawer
        open={namespaceDrawerOpen}
        onClose={() => setNamespaceDrawerOpen(false)}
        token={props.token}
        namespaceName={summary?.namespace || drawerNamespace || null}
      />
    </RightDrawer>
  );
}
