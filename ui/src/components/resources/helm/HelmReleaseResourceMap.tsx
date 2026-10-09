import React, { useCallback, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Stack } from "@mui/material";
import type { ApiResourceIdentity, ResourceOwnershipResponse, ResourcePresenceItem } from "../../../types/api";
import type { ManifestResource } from "../../../utils/helmManifest";
import { ResourceMapView } from "../../shared/ResourceMapPanel";
import { supportsResourceIdentityDrawer } from "../../shared/ResourceIdentityDrawer";
import { ownershipHistoryIDs } from "../../shared/resourceOwnershipPresentation";
import { buildHelmReleaseResourceMap, canOpenHelmManifestIdentity, isObservedHelmIdentity, manifestResourceForIdentity, mergeHelmOwnership } from "./helmReleaseResourceMapModel";

export default function HelmReleaseResourceMap({
  releaseName, releaseNamespace, manifestResources, presenceItems, ownership, ownershipError, onOpenResource, onOpenIdentity,
}: {
  releaseName: string;
  releaseNamespace: string;
  manifestResources: ManifestResource[];
  presenceItems?: ResourcePresenceItem[];
  ownership?: ResourceOwnershipResponse;
  ownershipError?: string;
  onOpenResource: (resource: ManifestResource) => void;
  onOpenIdentity?: (identity: ApiResourceIdentity) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const response = useMemo(() => mergeHelmOwnership(buildHelmReleaseResourceMap(releaseName, releaseNamespace, manifestResources, presenceItems), ownership), [manifestResources, presenceItems, ownership, releaseName, releaseNamespace]);
  const history = useMemo(() => ownershipHistoryIDs(response.nodes, response.edges), [response]);
  const visible = useMemo(() => showHistory ? response : {
    ...response,
    nodes: response.nodes.filter((node) => !history.has(node.id)),
    edges: response.edges.filter((edge) => !history.has(edge.from) && !history.has(edge.to)),
  }, [response, showHistory, history]);
  const canOpenResource = useCallback((identity: ApiResourceIdentity) =>
    Boolean(onOpenIdentity && isObservedHelmIdentity(ownership, identity) && supportsResourceIdentityDrawer(identity)) || canOpenHelmManifestIdentity(manifestResources, releaseNamespace, identity),
  [manifestResources, releaseNamespace, onOpenIdentity, ownership]);
  const openResource = useCallback((identity: ApiResourceIdentity) => {
    if (onOpenIdentity && isObservedHelmIdentity(ownership, identity) && supportsResourceIdentityDrawer(identity)) { onOpenIdentity(identity); return; }
    const resource = manifestResourceForIdentity(manifestResources, releaseNamespace, identity);
    if (resource) onOpenResource(resource);
  }, [manifestResources, onOpenResource, onOpenIdentity, releaseNamespace, ownership]);

  return <Box sx={{ height: "100%", overflow: "auto" }}>
    <Stack spacing={1}>
      <Alert severity="info">Rendered Helm declarations plus cached workload ownership (two hops). Pods are grouped by immediate owner; expand one bounded member sample at a time without fetching. Unknown cache state does not mean absent or healthy. Custom descendants and non-owner relationships are not evaluated.</Alert>
      {ownershipError ? <Alert severity="warning">{ownershipError}</Alert> : null}
      {response.truncated ? <Alert severity="warning">Map truncated: {response.truncationReasons?.join(", ")}. Displayed counts are not full cluster totals.</Alert> : null}
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip size="small" label={`${response.edges.filter((edge) => edge.type === "helmManifest").length} declarations shown`} />
        <Chip size="small" label={ownership ? `${ownership.cache.freshness || "unknown"} cache · ${ownership.cache.snapshotsMissing} missing snapshots` : "Declaration-only · cache not loaded"} variant="outlined" />
        {history.size ? <Button size="small" aria-expanded={showHistory} onClick={() => setShowHistory((shown) => !shown)}>{showHistory ? "Hide" : "Show"} workload history ({history.size})</Button> : null}
      </Stack>
      <ResourceMapView response={visible} podGroups={ownership?.podGroups} presentationMaxNodes={200} onOpenResource={openResource} canOpenResource={canOpenResource} showCacheFreshness={false} layoutDirection="LR" />
      {ownership ? <Box component="details"><Box component="summary" sx={{ cursor: "pointer", typography: "caption" }}>Cache coverage and limits</Box><Box sx={{ typography: "caption" }}>{ownership.coverage.reasons?.join("; ")} · Scan {ownership.cache.scannedRecords}/{ownership.limits.maxScanRecords}; topology limit {ownership.limits.maxNodes}; up to {ownership.maxMembers} members per owner. Group state counts describe observed Pods only; Running is not a readiness guarantee. Limited samples are distinct from collapsed groups.</Box></Box> : null}
    </Stack>
  </Box>;
}
