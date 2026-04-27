import React from "react";
import { Box } from "@mui/material";
import type { DataplaneListMeta } from "../../types/api";
import { fmtTimeAgo } from "../../utils/format";
import { dataplaneCoarseStateChipColor, formatChipLabel } from "../../utils/k8sUi";
import ScopedCountChip from "./ScopedCountChip";

type Props = {
  meta: DataplaneListMeta | null;
  /** Shown before meta line, e.g. namespace list row-projection caption */
  prefix?: React.ReactNode;
};

/** Compact list-level quality line for cached resource lists (shown under the toolbar). */
export default function DataplaneListMetaStrip({ meta, prefix }: Props) {
  if (!meta || (!meta.state && !meta.freshness && !meta.observed)) {
    return null;
  }

  const checkedValue = (() => {
    const raw = meta.observed;
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const num = Number(raw);
      return fmtTimeAgo(num > 1e12 ? Math.floor(num / 1000) : num);
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return fmtTimeAgo(Math.floor(parsed / 1000));
    }
    return raw;
  })();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mb: 1 }}>
      {prefix}
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
        {meta.state && (
          <ScopedCountChip size="small" label="Sync" count={formatChipLabel(meta.state)} color={dataplaneCoarseStateChipColor(meta.state)} />
        )}
        <ScopedCountChip size="small" variant="outlined" label="Updated" count={formatChipLabel(meta.freshness ?? "—")} />
        <ScopedCountChip size="small" variant="outlined" label="Scope" count={formatChipLabel(meta.coverage ?? "—")} />
        <ScopedCountChip size="small" variant="outlined" label="Issues" count={formatChipLabel(meta.degradation ?? "—")} />
        <ScopedCountChip size="small" variant="outlined" label="Detail" count={formatChipLabel(meta.completeness ?? "—")} />
        {checkedValue ? <ScopedCountChip size="small" variant="outlined" label="Checked" count={checkedValue} /> : null}
      </Box>
    </Box>
  );
}
