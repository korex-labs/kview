import React from "react";
import { Box, Chip, Typography } from "@mui/material";
import type { DataplaneListMeta } from "../../types/api";
import { dataplaneCoarseStateChipColor } from "../../utils/k8sUi";

type Props = {
  meta: DataplaneListMeta | null;
  /** Shown before meta line, e.g. namespace list row-projection caption */
  prefix?: React.ReactNode;
};

/**
 * Compact list-level dataplane truthfulness line (freshness, coverage, degradation, completeness, state).
 * Rationale: one pattern for all dataplane-backed resource lists without forcing identical page layouts.
 */
export default function DataplaneListMetaStrip({ meta, prefix }: Props) {
  if (!meta || (!meta.state && !meta.freshness && !meta.observed)) {
    return null;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
      {prefix}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
        {meta.state && (
          <Chip size="small" label={`State: ${meta.state}`} color={dataplaneCoarseStateChipColor(meta.state)} />
        )}
        <Typography variant="caption" color="text.secondary" component="span">
          Freshness {meta.freshness ?? "—"} · Coverage {meta.coverage ?? "—"} · Degradation {meta.degradation ?? "—"} ·
          Completeness {meta.completeness ?? "—"}
          {meta.observed ? ` · Observed ${meta.observed}` : ""}
        </Typography>
      </Box>
    </Box>
  );
}
