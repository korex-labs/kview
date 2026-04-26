import React from "react";
import { Box, Chip, Typography } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { DashboardSignalItem } from "../../types/api";
import type { ChipColor } from "../../utils/k8sUi";
import { fmtTimeAgo } from "../../utils/format";
import Section from "./Section";
import SignalHintIcons from "./SignalHintIcons";
import StatusChip from "./StatusChip";

export type AttentionHealth = {
  label: string;
  tone?: ChipColor;
  tooltip?: string;
};

export type AttentionReason = {
  label: string;
  severity?: "error" | "warning" | "info";
  tooltip?: string;
};

export type AttentionSummaryProps = {
  /** Deprecated. Ignored; retained to avoid breaking migrated drawers mid-rollout. */
  health?: AttentionHealth;
  /** Deprecated. Ignored; retained to avoid breaking migrated drawers mid-rollout. */
  reasons?: AttentionReason[];
  /** Per-resource signals from the dataplane signal engine. */
  signals?: DashboardSignalItem[];
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToEvents?: () => void;
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToConditions?: () => void;
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToSpec?: () => void;
};

function severityColor(severity?: string): "error" | "warning" | "info" | "default" {
  if (severity === "high" || severity === "error") return "error";
  if (severity === "medium" || severity === "warning") return "warning";
  if (severity === "low" || severity === "info") return "info";
  return "default";
}

function signalText(signal: DashboardSignalItem): string {
  const actual = signal.actualData || signal.reason;
  const parts = [actual];
  if (signal.calculatedData && signal.calculatedData !== actual) parts.push(`Calculated: ${signal.calculatedData}`);
  if (signal.firstSeenAt) parts.push(`First seen ${fmtTimeAgo(signal.firstSeenAt)}`);
  if (signal.lastSeenAt) parts.push(`Last verified ${fmtTimeAgo(signal.lastSeenAt)}`);
  return parts.join(" · ");
}

function isEmpty(props: AttentionSummaryProps): boolean {
  const { signals } = props;
  if (signals && signals.length > 0) return false;
  return true;
}

/**
 * AttentionSummary renders the top-of-overview state callout for a resource
 * drawer: top-signal preview.
 *
 * It returns null when the resource has no attention-worthy state so drawers
 * can render it unconditionally at the top of the Overview tab.
 *
 * This component is display-only. It does not derive warnings from raw state;
 * all inputs must come from the backend dataplane signal engine or DTO
 * fields populated by the backend. See docs/UI_UX_GUIDE.md "Signals-first
 * Drawer Content".
 */
export default function AttentionSummary(props: AttentionSummaryProps) {
  if (isEmpty(props)) return null;

  const { signals = [] } = props;

  return (
    <Section title="Attention" divider={false} headerSx={{ mb: 0.5 }}>
      <Box
        sx={{
          border: "1px solid var(--chip-warning-border)",
          borderRadius: 2,
          p: 1.25,
          backgroundColor: "var(--chip-warning-bg)",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <WarningAmberIcon sx={{ color: "warning.main", fontSize: 20 }} />
        </Box>

        {signals.length > 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {signals.slice(0, 3).map((signal, idx) => (
              <Box
                key={`${signal.signalType || signal.kind}-${signal.name || idx}`}
                data-signal-row
                sx={{ color: "text.primary", display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}
              >
                <StatusChip size="small" color={severityColor(signal.severity)} label={signal.severity || "info"} />
                <Typography component="span" variant="body2">
                  {signalText(signal)}
                </Typography>
                <SignalHintIcons
                  likelyCause={signal.likelyCause}
                  suggestedAction={signal.suggestedAction}
                />
              </Box>
            ))}
            {signals.length > 3 ? (
              <Typography variant="caption" color="text.secondary">
                +{signals.length - 3} more signal{signals.length - 3 === 1 ? "" : "s"}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Section>
  );
}
