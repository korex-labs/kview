import React, { useCallback, useMemo } from "react";
import { Alert, Box, Chip, Stack } from "@mui/material";
import type { ApiResourceIdentity, ResourcePresenceItem } from "../../../types/api";
import type { ManifestResource } from "../../../utils/helmManifest";
import { ResourceMapView } from "../../shared/ResourceMapPanel";
import {
  buildHelmReleaseResourceMap,
  canOpenHelmManifestIdentity,
  manifestResourceForIdentity,
} from "./helmReleaseResourceMapModel";

export default function HelmReleaseResourceMap({
  releaseName,
  releaseNamespace,
  manifestResources,
  presenceItems,
  onOpenResource,
}: {
  releaseName: string;
  releaseNamespace: string;
  manifestResources: ManifestResource[];
  presenceItems?: ResourcePresenceItem[];
  onOpenResource: (resource: ManifestResource) => void;
}) {
  const response = useMemo(
    () => buildHelmReleaseResourceMap(releaseName, releaseNamespace, manifestResources, presenceItems),
    [manifestResources, presenceItems, releaseName, releaseNamespace],
  );
  const canOpenResource = useCallback(
    (identity: ApiResourceIdentity) => canOpenHelmManifestIdentity(manifestResources, releaseNamespace, identity),
    [manifestResources, releaseNamespace],
  );
  const openResource = useCallback((identity: ApiResourceIdentity) => {
    const resource = manifestResourceForIdentity(manifestResources, releaseNamespace, identity);
    if (resource) onOpenResource(resource);
  }, [manifestResources, onOpenResource, releaseNamespace]);

  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Stack spacing={1}>
        <Alert severity="info">
          This map is derived from the rendered Helm release manifest. Availability is enriched only from already-loaded dataplane snapshots; unknown does not mean absent.
        </Alert>
        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Chip size="small" label={`${response.cache.totalEdges} declared resources`} />
          <Chip size="small" label="Manifest-derived" variant="outlined" />
          {response.truncated ? <Chip size="small" label={`${response.cache.returnedEdges} shown`} color="warning" variant="outlined" /> : null}
        </Stack>
        <ResourceMapView
          response={response}
          onOpenResource={openResource}
          canOpenResource={canOpenResource}
          showCacheFreshness={false}
          layoutDirection="LR"
        />
      </Stack>
    </Box>
  );
}
