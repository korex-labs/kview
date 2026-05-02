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
  TableBody,
  TableRow,
  TableCell,
} from "@mui/material";
import { apiGet } from "../../../api";
import { useConnectionState } from "../../../connectionState";
import { fmtTs, valueOrDash } from "../../../utils/format";
import { helmStatusChipColor } from "../../../utils/k8sUi";
import { parseManifestResources, groupResourcesByKind, canNavigateToKind, isCRManifestResource, parseApiVersion } from "../../../utils/helmManifest";
import type { ManifestResource } from "../../../utils/helmManifest";
import Section from "../../shared/Section";
import DrawerActionStrip from "../../shared/DrawerActionStrip";
import KeyValueTable from "../../shared/KeyValueTable";
import AttentionSummary from "../../shared/AttentionSummary";
import EmptyState from "../../shared/EmptyState";
import ErrorState from "../../shared/ErrorState";
import ResourceLinkChip from "../../shared/ResourceLinkChip";
import ResourceYamlPanel from "../../shared/ResourceYamlPanel";
import AutolinkText from "../../shared/AutolinkText";
import StatusChip from "../../shared/StatusChip";
import { HelmReleaseActions, HelmRollbackActionButton } from "./HelmActions";
import DeploymentDrawer from "../deployments/DeploymentDrawer";
import StatefulSetDrawer from "../statefulsets/StatefulSetDrawer";
import DaemonSetDrawer from "../daemonsets/DaemonSetDrawer";
import ServiceDrawer from "../services/ServiceDrawer";
import IngressDrawer from "../ingresses/IngressDrawer";
import ConfigMapDrawer from "../configmaps/ConfigMapDrawer";
import SecretDrawer from "../secrets/SecretDrawer";
import JobDrawer from "../jobs/JobDrawer";
import CronJobDrawer from "../cronjobs/CronJobDrawer";
import HorizontalPodAutoscalerDrawer from "../horizontalpodautoscalers/HorizontalPodAutoscalerDrawer";
import PersistentVolumeClaimDrawer from "../persistentvolumeclaims/PersistentVolumeClaimDrawer";
import PersistentVolumeDrawer from "../persistentvolumes/PersistentVolumeDrawer";
import ServiceAccountDrawer from "../serviceaccounts/ServiceAccountDrawer";
import RoleDrawer from "../roles/RoleDrawer";
import RoleBindingDrawer from "../rolebindings/RoleBindingDrawer";
import ClusterRoleDrawer from "../clusterroles/ClusterRoleDrawer";
import ClusterRoleBindingDrawer from "../clusterrolebindings/ClusterRoleBindingDrawer";
import CustomResourceDefinitionDrawer from "../customresourcedefinitions/CustomResourceDefinitionDrawer";
import CustomResourceDrawer, { type CRRef } from "../customresources/CustomResourceDrawer";
import PodDrawer from "../pods/PodDrawer";
import NodeDrawer from "../nodes/NodeDrawer";
import NamespaceDrawer from "../namespaces/NamespaceDrawer";
import RightDrawer from "../../layout/RightDrawer";
import ResourceDrawerShell from "../../shared/ResourceDrawerShell";
import DetailTabIcon from "../../shared/DetailTabIcon";
import type { ApiItemResponse, DashboardSignalItem } from "../../../types/api";
import useResourceSignals from "../../../utils/useResourceSignals";
import { panelBoxSx, drawerBodySx, loadingCenterSx } from "../../../theme/sxTokens";

type HelmHook = {
  name: string;
  kind: string;
  events: string[];
  weight: number;
  deletePolicies?: string[];
};

type HelmReleaseDetails = {
  summary: HelmReleaseSummary;
  history: HelmReleaseRevision[];
  notes?: string;
  values?: string;
  manifest?: string;
  hooks?: HelmHook[];
  yaml?: string;
};

type HelmReleaseSummary = {
  name: string;
  namespace: string;
  status: string;
  revision: number;
  updated: number;
  chart: string;
  chartName: string;
  chartVersion: string;
  appVersion: string;
  storageBackend: string;
  description?: string;
  firstDeployed?: number;
  lastDeployed?: number;
};

type HelmReleaseRevision = {
  revision: number;
  status: string;
  updated: number;
  chart: string;
  chartVersion: string;
  appVersion: string;
  description?: string;
};

function canRollbackRevision(rev: HelmReleaseRevision, currentRevision?: number): boolean {
  if (currentRevision != null && rev.revision === currentRevision) return false;
  return rev.status === "deployed" || rev.status === "superseded";
}

export default function HelmReleaseDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  releaseName: string | null;
  onRefresh?: () => void;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<HelmReleaseDetails | null>(null);
  const [err, setErr] = useState("");

  // Sub-drawer state for cross-links
  const [linkedResource, setLinkedResource] = useState<ManifestResource | null>(null);
  const [linkedCR, setLinkedCR] = useState<CRRef | null>(null);
  const [drawerNamespace, setDrawerNamespace] = useState<string | null>(null);

  const ns = props.namespace;
  const name = props.releaseName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setLoading(true);
    setLinkedResource(null);
    setLinkedCR(null);
    setDrawerNamespace(null);

    (async () => {
      const det = await apiGet<ApiItemResponse<HelmReleaseDetails>>(
        `/api/namespaces/${encodeURIComponent(ns)}/helmreleases/${encodeURIComponent(name)}`,
        props.token,
      );
      const item: HelmReleaseDetails | null = det?.item ?? null;
      setDetails(item);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce, refreshNonce]);

  const summary = details?.summary;
  const history = details?.history || [];
  const notes = details?.notes || "";
  const values = details?.values || "";
  const manifest = details?.manifest || "";
  const hooks = useMemo(() => details?.hooks || [], [details?.hooks]);
  const yaml = details?.yaml || "";
  const resourceSignals = useResourceSignals({
    token: props.token,
    scope: "namespace",
    namespace: ns,
    kind: "helmreleases",
    name: name || "",
    enabled: !!props.open && !!name,
    refreshKey: retryNonce + refreshNonce,
  });

  // Parse manifest resources for cross-links
  const manifestResources = useMemo(
    () => (manifest ? parseManifestResources(manifest) : []),
    [manifest],
  );
  const groupedResources = useMemo(
    () => groupResourcesByKind(manifestResources),
    [manifestResources],
  );
  const helmSignals = useMemo<DashboardSignalItem[]>(
    () => resourceSignals.signals || [],
    [resourceSignals.signals],
  );

  // Build tab labels dynamically, hiding empty optional tabs.
  const tabDefs = useMemo(() => {
    const tabs: { label: string; id: string }[] = [{ label: "Overview", id: "overview" }];
    if (values.trim()) tabs.push({ label: "Values", id: "values" });
    if (manifest.trim()) tabs.push({ label: "Manifest", id: "manifest" });
    if (hooks.length > 0) tabs.push({ label: "Hooks", id: "hooks" });
    tabs.push({ label: "History", id: "history" });
    if (notes.trim()) tabs.push({ label: "Notes", id: "notes" });
    tabs.push({ label: "Metadata", id: "metadata" });
    if (yaml.trim()) tabs.push({ label: "YAML", id: "yaml" });
    return tabs;
  }, [values, manifest, hooks, notes, yaml]);

  const activeTabId = tabDefs[tab]?.id || "overview";

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      {
        label: "Namespace",
        value: summary?.namespace ? (
          <ResourceLinkChip label={summary.namespace} onClick={() => setDrawerNamespace(summary.namespace)} />
        ) : (
          "-"
        ),
      },
      {
        label: "Status",
        value: (
          <StatusChip size="small" label={valueOrDash(summary?.status)} color={helmStatusChipColor(summary?.status)} />
        ),
      },
      { label: "Revision", value: valueOrDash(summary?.revision) },
      { label: "Chart", value: valueOrDash(summary?.chart) },
      { label: "Chart Version", value: valueOrDash(summary?.chartVersion) },
      { label: "App Version", value: valueOrDash(summary?.appVersion) },
      { label: "Storage", value: valueOrDash(summary?.storageBackend) },
      { label: "First Deployed", value: summary?.firstDeployed ? fmtTs(summary.firstDeployed) : "-" },
      { label: "Last Deployed", value: summary?.lastDeployed ? fmtTs(summary.lastDeployed) : "-" },
    ],
    [summary],
  );

  function openManifestResource(r: ManifestResource) {
    if (r.kind === "Namespace") {
      setDrawerNamespace(r.name);
      return;
    }
    if (canNavigateToKind(r.kind)) {
      setLinkedResource(r);
      return;
    }
    if (isCRManifestResource(r)) {
      const parsed = r.apiVersion ? parseApiVersion(r.apiVersion) : null;
      setLinkedCR({
        group: parsed?.group ?? "",
        version: parsed?.version ?? "",
        // resource (plural) is absent here — CustomResourceDrawer resolves it lazily
        kind: r.kind,
        namespace: r.namespace ?? ns,
        name: r.name,
      });
    }
  }

  function hookResource(hook: HelmHook): ManifestResource {
    return { kind: hook.kind, name: hook.name, namespace: ns };
  }

  const linkedKind = linkedResource?.kind;

  return (
    <RightDrawer open={props.open} onClose={props.onClose}>
      <ResourceDrawerShell resourceIcon="helm"
        title={
          <>
            Helm Release: {name || "-"}{" "}
            <ResourceLinkChip label={ns} onClick={() => setDrawerNamespace(ns)} />
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
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
              {tabDefs.map((t) => (
                <Tab key={t.id} icon={<DetailTabIcon label={t.label} />} iconPosition="start" label={t.label} />
              ))}
            </Tabs>

            <Box sx={drawerBodySx}>
              {/* OVERVIEW */}
              {activeTabId === "overview" && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    height: "100%",
                    overflow: "auto",
                  }}
                >
                  {name && (
                    <DrawerActionStrip>
                      <HelmReleaseActions
                        token={props.token}
                        namespace={ns}
                        releaseName={name}
                        onRefresh={() => {
                          setRefreshNonce((n) => n + 1);
                          props.onRefresh?.();
                        }}
                        onDeleted={() => {
                          props.onClose();
                          props.onRefresh?.();
                        }}
                      />
                    </DrawerActionStrip>
                  )}

                  <AttentionSummary
                    signals={helmSignals}
                  />

                  {summary?.description && (
                    <Section title="Description">
                      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                        {summary.description}
                      </Typography>
                    </Section>
                  )}

                  {/* Managed Resources (cross-links from manifest) */}
                  {groupedResources.length > 0 && (
                    <Section title="Managed Resources">
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
                        {groupedResources.map((group) => (
                          <Box key={group.kind}>
                            <Typography variant="caption" color="text.secondary">
                              {group.kind} ({group.items.length})
                            </Typography>
                            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                              {group.items.map((r) => (
                                <ResourceLinkChip
                                  key={`${r.kind}/${r.namespace || ""}/${r.name}`}
                                  label={r.name}
                                  onClick={
                                    canNavigateToKind(r.kind) || isCRManifestResource(r)
                                      ? () => openManifestResource(r)
                                      : undefined
                                  }
                                />
                              ))}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Section>
                  )}
                </Box>
              )}

              {/* VALUES */}
              {activeTabId === "values" && (
                <ResourceYamlPanel code={values} token={props.token} />
              )}

              {/* MANIFEST */}
              {activeTabId === "manifest" && (
                <ResourceYamlPanel code={manifest} token={props.token} />
              )}

              {/* HOOKS */}
              {activeTabId === "hooks" && (
                <Box sx={{ height: "100%", overflow: "auto" }}>
                  {hooks.length === 0 ? (
                    <EmptyState message="No hooks found." />
                  ) : (
                    <Table size="small" sx={{ tableLayout: "fixed", width: "100%" }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Kind</TableCell>
                          <TableCell>Events</TableCell>
                          <TableCell>Weight</TableCell>
                          <TableCell>Delete Policies</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {hooks.map((hook, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              {hook.name && canNavigateToKind(hook.kind) ? (
                                <ResourceLinkChip
                                  label={hook.name}
                                  onClick={() => openManifestResource(hookResource(hook))}
                                />
                              ) : (
                                valueOrDash(hook.name)
                              )}
                            </TableCell>
                            <TableCell>{valueOrDash(hook.kind)}</TableCell>
                            <TableCell>
                              {hook.events?.length
                                ? hook.events.map((e) => (
                                    <Chip key={e} size="small" label={e} sx={{ mr: 0.5, mb: 0.5 }} />
                                  ))
                                : "-"}
                            </TableCell>
                            <TableCell>{hook.weight}</TableCell>
                            <TableCell>
                              {hook.deletePolicies?.length
                                ? hook.deletePolicies.join(", ")
                                : "-"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* HISTORY */}
              {activeTabId === "history" && (
                <Box sx={{ height: "100%", overflow: "auto" }}>
                  {history.length === 0 ? (
                    <EmptyState message="No revision history found." />
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Revision</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Chart</TableCell>
                          <TableCell>App Version</TableCell>
                          <TableCell>Updated</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {history.map((rev) => (
                          <TableRow key={rev.revision}>
                            <TableCell>{rev.revision}</TableCell>
                            <TableCell>
                              <StatusChip size="small" label={valueOrDash(rev.status)} color={helmStatusChipColor(rev.status)} />
                            </TableCell>
                            <TableCell>{valueOrDash(rev.chart)}</TableCell>
                            <TableCell>{valueOrDash(rev.appVersion)}</TableCell>
                            <TableCell>{fmtTs(rev.updated)}</TableCell>
                            <TableCell sx={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                              {valueOrDash(rev.description)}
                            </TableCell>
                            <TableCell align="right">
                              {name && canRollbackRevision(rev, summary?.revision) ? (
                                <HelmRollbackActionButton
                                  token={props.token}
                                  namespace={ns}
                                  releaseName={name}
                                  revision={rev.revision}
                                  onSuccess={() => {
                                    setRefreshNonce((n) => n + 1);
                                    props.onRefresh?.();
                                  }}
                                />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              )}

              {/* NOTES */}
              {activeTabId === "notes" && (
                <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
                  <Box
                    sx={{
                      flexGrow: 1,
                      overflow: "auto",
                      fontFamily: "monospace",
                      fontSize: "0.8rem",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      backgroundColor: "var(--code-bg)",
                      color: "var(--code-text)",
                      p: 1.5,
                      borderRadius: 1,
                      border: "1px solid var(--code-border)",
                    }}
                  >
                    <AutolinkText text={notes} />
                  </Box>
                </Box>
              )}

              {/* METADATA */}
              {activeTabId === "metadata" && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    height: "100%",
                    overflow: "auto",
                  }}
                >
                  <Box sx={panelBoxSx}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>
                </Box>
              )}

              {/* YAML */}
              {activeTabId === "yaml" && (
                <ResourceYamlPanel code={yaml} token={props.token} />
              )}
            </Box>

            {/* Sub-drawers for cross-linked resources */}
            <DeploymentDrawer
              open={linkedKind === "Deployment"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              deploymentName={linkedResource?.kind === "Deployment" ? linkedResource.name : null}
            />
            <StatefulSetDrawer
              open={linkedKind === "StatefulSet"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              statefulSetName={linkedResource?.kind === "StatefulSet" ? linkedResource.name : null}
            />
            <DaemonSetDrawer
              open={linkedKind === "DaemonSet"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              daemonSetName={linkedResource?.kind === "DaemonSet" ? linkedResource.name : null}
            />
            <ServiceDrawer
              open={linkedKind === "Service"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              serviceName={linkedResource?.kind === "Service" ? linkedResource.name : null}
            />
            <IngressDrawer
              open={linkedKind === "Ingress"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              ingressName={linkedResource?.kind === "Ingress" ? linkedResource.name : null}
            />
            <ConfigMapDrawer
              open={linkedKind === "ConfigMap"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              configMapName={linkedResource?.kind === "ConfigMap" ? linkedResource.name : null}
            />
            <SecretDrawer
              open={linkedKind === "Secret"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              secretName={linkedResource?.kind === "Secret" ? linkedResource.name : null}
            />
            <JobDrawer
              open={linkedKind === "Job"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              jobName={linkedResource?.kind === "Job" ? linkedResource.name : null}
            />
            <CronJobDrawer
              open={linkedKind === "CronJob"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              cronJobName={linkedResource?.kind === "CronJob" ? linkedResource.name : null}
            />
            <HorizontalPodAutoscalerDrawer
              open={linkedKind === "HorizontalPodAutoscaler"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              hpaName={linkedResource?.kind === "HorizontalPodAutoscaler" ? linkedResource.name : null}
            />
            <PersistentVolumeClaimDrawer
              open={linkedKind === "PersistentVolumeClaim"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              persistentVolumeClaimName={linkedResource?.kind === "PersistentVolumeClaim" ? linkedResource.name : null}
            />
            <PersistentVolumeDrawer
              open={linkedKind === "PersistentVolume"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              persistentVolumeName={linkedResource?.kind === "PersistentVolume" ? linkedResource.name : null}
            />
            <ServiceAccountDrawer
              open={linkedKind === "ServiceAccount"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              serviceAccountName={linkedResource?.kind === "ServiceAccount" ? linkedResource.name : null}
            />
            <RoleDrawer
              open={linkedKind === "Role"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              roleName={linkedResource?.kind === "Role" ? linkedResource.name : null}
            />
            <RoleBindingDrawer
              open={linkedKind === "RoleBinding"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              roleBindingName={linkedResource?.kind === "RoleBinding" ? linkedResource.name : null}
            />
            <ClusterRoleDrawer
              open={linkedKind === "ClusterRole"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              clusterRoleName={linkedResource?.kind === "ClusterRole" ? linkedResource.name : null}
            />
            <ClusterRoleBindingDrawer
              open={linkedKind === "ClusterRoleBinding"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              clusterRoleBindingName={linkedResource?.kind === "ClusterRoleBinding" ? linkedResource.name : null}
            />
            <PodDrawer
              open={linkedKind === "Pod"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              namespace={linkedResource?.namespace || ns}
              podName={linkedResource?.kind === "Pod" ? linkedResource.name : null}
            />
            <NodeDrawer
              open={linkedKind === "Node"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              nodeName={linkedResource?.kind === "Node" ? linkedResource.name : null}
            />
            <CustomResourceDefinitionDrawer
              open={linkedKind === "CustomResourceDefinition"}
              onClose={() => setLinkedResource(null)}
              token={props.token}
              crdName={linkedResource?.kind === "CustomResourceDefinition" ? linkedResource.name : null}
            />
            <NamespaceDrawer
              open={!!drawerNamespace}
              onClose={() => setDrawerNamespace(null)}
              token={props.token}
              namespaceName={drawerNamespace}
            />
            <CustomResourceDrawer
              open={!!linkedCR}
              onClose={() => setLinkedCR(null)}
              token={props.token}
              crRef={linkedCR}
            />
          </>
        )}
      </ResourceDrawerShell>
    </RightDrawer>
  );
}
