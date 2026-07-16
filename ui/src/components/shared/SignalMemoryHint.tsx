import React from "react";
import { Box } from "@mui/material";
import type { DashboardSignalItem } from "../../types/api";
import StatusChip from "./StatusChip";

export type SignalMemoryHintValue = {
  label: string;
  tooltip: string;
};

export function signalMemoryHintValue(signal: DashboardSignalItem): SignalMemoryHintValue | null {
  const observedDays7d = Math.max(0, signal.observedDays7d || 0);
  const observedDays30d = Math.max(observedDays7d, signal.observedDays30d || 0);
  if (observedDays7d >= 2) {
    return {
      label: `Seen ${observedDays7d}d / 7d`,
      tooltip: `Observed on ${observedDays7d} distinct UTC days in the last 7 days. This is local signal memory, not a count of separate resolved incidents.`,
    };
  }
  if (observedDays30d >= 2) {
    return {
      label: `Seen ${observedDays30d}d / 30d`,
      tooltip: `Observed on ${observedDays30d} distinct UTC days in the last 30 days. This is local signal memory, not a count of separate resolved incidents.`,
    };
  }
  return null;
}

export default function SignalMemoryHint({ signal }: { signal: DashboardSignalItem }) {
  const hint = signalMemoryHintValue(signal);
  if (!hint) return null;
  return (
    <Box title={hint.tooltip} sx={{ display: "inline-flex" }}>
      <StatusChip size="small" color="info" variant="outlined" label={hint.label} />
    </Box>
  );
}
