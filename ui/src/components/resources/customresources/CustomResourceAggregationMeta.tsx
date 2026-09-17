import React from "react";
import { Typography } from "@mui/material";
export type AggregationMeta = {
  totalKinds: number; accessibleKinds: number; deniedKinds: number; errorKinds: number;
  discovery?: { source: string; listDenied: boolean; universeUnknown: boolean; candidateLimit: number; candidates: number;
    confirmed: number; denied: number; notFound: number; errors: number; truncated: boolean };
};
export default function CustomResourceAggregationMeta({ meta }: { meta: AggregationMeta | null }) {
  if (!meta) return null;
  const discovery = meta.discovery;
  return <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
    {meta.accessibleKinds} accessible kind{meta.accessibleKinds !== 1 ? "s" : ""}
    {meta.deniedKinds > 0 ? ` · ${meta.deniedKinds} access denied` : ""}
    {meta.errorKinds > 0 ? ` · ${meta.errorKinds} error` : ""}
    {discovery && <>
      {` · Discovery: ${discovery.source}`}
      {discovery.universeUnknown ? " · Partial discovery — total kind universe unknown" : ""}
      {discovery.listDenied ? " · CRD listing denied" : ""}{discovery.truncated ? " · Candidate discovery truncated" : ""}
      {` · ${discovery.confirmed}/${discovery.candidates} candidate types confirmed · ${discovery.denied} denied · ${discovery.notFound} not found · ${discovery.errors} errors`}
      {" · Manifest references do not confirm live objects"}
    </>}
  </Typography>;
}
