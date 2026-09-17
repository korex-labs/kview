import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Chip, CircularProgress, Tabs, Tab, Typography } from "@mui/material";
import { apiGetWithContext, toApiError } from "../../../api";
import { useActiveContext } from "../../../activeContext";
import CodeBlock from "../../shared/CodeBlock";
import EventsPanel from "../../shared/EventsPanel";
import { AppButton } from "../../shared/AppActions";
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
  observedGeneration?: number;
};

type CRSummary = {
  uid?: string;
  resourceVersion?: string;
  generation?: number;
  statusObservedGeneration?: number;
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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

// Avoid expensive syntax highlighting for large fragments; keep display/copy complete.
const MAX_HIGHLIGHT_LENGTH = 100_000;

type CRDetails = {
  summary: CRSummary;
  spec?: JsonValue;
  status?: JsonValue;
  conditions?: CRCondition[];
  yaml: string;
};

export type CRRef = {
  uid?: string;
  scope?: "namespaced" | "cluster";
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

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  crRef: CRRef | null;
};

export default function CustomResourceDrawer(props: Props) {
  const contextName = useActiveContext();
  const ref = props.crRef;
  // Remount identity-owned state synchronously, before any stale content can render.
  const identity = JSON.stringify([contextName, props.token, props.open, ref?.group, ref?.version,
    ref?.resource, ref?.kind, ref?.scope, ref?.namespace, ref?.defaultNamespace, ref?.name, ref?.uid, ref?.provenance]);
  return <CustomResourceDrawerContent key={identity} {...props} contextName={contextName} />;
}

function CustomResourceDrawerContent(props: Props & { contextName: string }) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<CRDetails | null>(null);
  const [err, setErr] = useState("");
  const [errStatus, setErrStatus] = useState<number | undefined>();
  const [notFoundMessage, setNotFoundMessage] = useState<string | undefined>();
  const [namespaceDrawerOpen, setNamespaceDrawerOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [resolved, setResolved] = useState<{ resource: string; version: string; scope: string; namespace: string } | null>(null);
  const pinnedUID = useRef(props.crRef?.uid);
  const generation = useRef(0);
  const ref = props.crRef;
  const resolvedResource = resolved?.resource;
  const resolvedVersion = resolved?.version;
  const unresolvedManifestReference = ref?.provenance === "helmManifest" && !resolved && Boolean(err);

  useEffect(() => {
    if (!props.open || !ref) return;
    const controller = new AbortController();
    const request = ++generation.current;
    const current = () => !controller.signal.aborted && generation.current === request;
    setDetails(null);
    setResolved(null);
    setErr("");
    setErrStatus(undefined);
    setNotFoundMessage(undefined);
    setLoading(true);
    let resolving = !ref.resource;
    const load = async () => {
      if (!props.contextName) throw new Error("Missing active context");
      const options = { signal: controller.signal };
      const descriptor = ref.resource
        ? { resource: ref.resource, scope: ref.scope === "cluster" ? "Cluster" : ref.scope === "namespaced" ? "Namespaced" : ref.namespace ? "Namespaced" : "Cluster" }
        : await apiGetWithContext<ResolveResult>(`/api/customresources/resolve?group=${encodeURIComponent(ref.group)}&kind=${encodeURIComponent(ref.kind)}`, props.token, props.contextName, options);
      if (!current()) return;
      resolving = false;
      const namespace = resolvedCustomResourceNamespace(ref, descriptor.scope);
      if ((descriptor.scope === "Cluster" && namespace) || (descriptor.scope === "Namespaced" && !namespace)) {
        throw new Error("Custom resource scope and namespace do not match");
      }
      const version = ref.version;
      const params = new URLSearchParams();
      if (namespace) params.set("namespace", namespace);
      const path = `/api/customresources/${encodeURIComponent(ref.group)}/${encodeURIComponent(version)}/${encodeURIComponent(descriptor.resource)}/${encodeURIComponent(ref.name)}${params.size ? `?${params}` : ""}`;
      const result = await apiGetWithContext<ApiItemResponse<CRDetails>>(path, props.token, props.contextName, options);
      if (!current()) return;
      if (!result?.item) throw new Error("Custom resource detail response is missing");
      if (pinnedUID.current && result.item.summary.uid !== pinnedUID.current) {
        throw new Error("Custom resource UID changed; reopen the object to inspect its replacement");
      }
      pinnedUID.current = result.item.summary.uid;
      setResolved({ resource: descriptor.resource, version, scope: descriptor.scope || (namespace ? "Namespaced" : "Cluster"), namespace });
      setDetails(result.item);
    };
    void load().catch((error: unknown) => {
      if (!current()) return;
      const apiError = toApiError(error);
      setErr(apiError.message);
      setErrStatus(apiError.status);
      if (resolving && apiError.status === 404) {
        setNotFoundMessage("CRD metadata for this manifest reference is not available in the active context. The row does not confirm that a live custom resource exists.");
      }
    }).finally(() => {
      if (current()) setLoading(false);
    });
    return () => controller.abort();
    // The outer keyed boundary owns reference, context, and token changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.contextName, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const fragment = tab === 1 ? details?.spec : tab === 2 ? details?.status : undefined;
  const fragmentCode = useMemo(() => fragment === undefined ? undefined : JSON.stringify(fragment, null, 2), [fragment]);
  const drawerNamespace = resolved?.namespace ?? ref?.namespace ?? "";
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
      { label: "UID", value: summary?.uid ?? "Absent", monospace: true },
      { label: "Resource version", value: summary?.resourceVersion ?? "Absent", monospace: true },
      { label: "Generation", value: summary?.generation ?? "Absent" },
      { label: "Status observed generation", value: summary?.statusObservedGeneration ?? "Absent" },
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
            uid: summary?.uid,
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
          <Box sx={drawerTabContentSx}>
            <ErrorState message={err} status={errStatus} notFoundMessage={notFoundMessage} />
            <AppButton onClick={() => setRefreshNonce((value) => value + 1)}>Retry details</AppButton>
          </Box>
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab data-keyboard-action-id="drawer.tab.overview" icon={<DetailTabIcon label="Overview" />} iconPosition="start" label="Overview" />
              <Tab data-keyboard-action-id="drawer.tab.spec" icon={<DetailTabIcon label="Spec" />} iconPosition="start" label="Spec" />
              <Tab data-keyboard-action-id="drawer.tab.status" icon={<DetailTabIcon label="Status" />} iconPosition="start" label="Status" />
              <Tab data-keyboard-action-id="drawer.tab.metadata" icon={<DetailTabIcon label="Metadata" />} iconPosition="start" label="Metadata" />
              <Tab data-keyboard-action-id="drawer.tab.events" icon={<DetailTabIcon label="Events" />} iconPosition="start" label="Events" />
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
                  {/* Raw conditions have controller-specific polarity. Observed
                      generation is evidence, not a health verdict; do not color
                      arbitrary True values healthy. */}
                  <ConditionsTable
                    conditions={details?.conditions || []}
                    isHealthy={() => true}
                    chipColor={() => "default"}
                    unhealthyFirst={false}
                    showObservedGeneration
                    variant="section"
                    title="Conditions"
                    emptyMessage="No conditions reported for this custom resource."
                  />
                </Box>
              )}

              {(tab === 1 || tab === 2) && (
                <Box sx={drawerTabContentSx}>
                  {fragmentCode === undefined ? <Typography>Absent</Typography> : (
                    <>
                      {fragmentCode.length > MAX_HIGHLIGHT_LENGTH && (
                        <Typography variant="caption">Large JSON fragment: syntax highlighting disabled. Display and Copy retain the full value.</Typography>
                      )}
                      <CodeBlock code={fragmentCode} language={fragmentCode.length <= MAX_HIGHLIGHT_LENGTH ? "json" : undefined} />
                    </>
                  )}
                </Box>
              )}
              {tab === 4 && ref && resolvedResource && (summary?.uid ? (
                <EventsPanel token={props.token} contextName={props.contextName}
                  endpoint={`/api/customresources/${encodeURIComponent(ref.group)}/${encodeURIComponent(ref.version)}/${encodeURIComponent(resolvedResource)}/${encodeURIComponent(ref.name)}/events?${new URLSearchParams({ ...(drawerNamespace ? { namespace: drawerNamespace } : {}), uid: summary.uid })}`} />
              ) : <ErrorState message="Events require a verified resource UID." />)}
              {tab === 3 && (
                <Box sx={drawerTabContentSx}>
                  <MetadataSection labels={summary?.labels} annotations={summary?.annotations} />
                </Box>
              )}

              {/* YAML */}
              {tab === 5 && ref && resolvedResource && (
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
