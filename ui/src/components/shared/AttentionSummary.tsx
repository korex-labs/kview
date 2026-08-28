import React from "react";
import { Box, Button, Typography } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { DashboardSignalItem } from "../../types/api";
import type { ChipColor } from "../../utils/k8sUi";
import SignalActions from "./SignalActions";
import SignalInvestigationDialog from "./SignalInvestigationDialog";
import SignalMemoryHint from "./SignalMemoryHint";
import StatusChip from "./StatusChip";
import { signalHistoryKey, signalWithHistoryKey } from "./signalIdentity";
import { rankAttentionSignals, signalCalculatedText, signalMetaText, signalSeverityColor } from "./signalFormat";

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
  /** Total suppressed signals for this resource, which may exceed the returned capped list. */
  suppressedSignalCount?: number;
  /** Backend-provided suppressed signals. Suppression is never derived locally. */
  suppressedSignals?: DashboardSignalItem[];
  token?: string;
  onSignalAckChanged?: () => void;
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToEvents?: () => void;
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToConditions?: () => void;
  /** Deprecated. Kept for backward-compatible callsites; ignored by this component. */
  onJumpToSpec?: () => void;
};

function isEmpty(props: AttentionSummaryProps): boolean {
  const { signals, suppressedSignalCount = 0 } = props;
  return !(signals && signals.length > 0) && suppressedSignalCount <= 0;
}

function suppressionModeLabel(signal: DashboardSignalItem): string {
  return signal.suppression?.mode === "until_changed" ? "Until changed" : "Snoozed";
}

function suppressionExpiryLabel(signal: DashboardSignalItem): string {
  const expiresAt = signal.suppression?.expiresAt;
  return expiresAt ? new Date(expiresAt * 1000).toLocaleString() : "";
}

function signalKindLabel(signal: DashboardSignalItem): string {
  return signal.kindLabel || signal.resourceKind || signal.kind;
}

function signalTargetLabel(signal: DashboardSignalItem): string {
  const name = signal.resourceName || signal.name || "";
  if (signal.namespace && name) return `${signal.namespace}/${name}`;
  return name || signal.scopeLocation || signal.namespace || signal.kind;
}

/**
 * AttentionSummary renders the top-of-overview state callout for a resource
 * drawer: top-signal preview and an operator-controlled suppressed-signal list.
 *
 * It returns null when the resource has no attention-worthy or suppressed state
 * so drawers can render it unconditionally at the top of the Overview tab.
 *
 * This component does not derive warnings or suppression from raw state; all
 * inputs must come from the backend dataplane signal engine or DTO fields
 * populated by the backend. See docs/UI_UX_GUIDE.md "Signals-first Drawer
 * Content".
 */
export default function AttentionSummary(props: AttentionSummaryProps) {
  const {
    signals = [],
    suppressedSignalCount = 0,
    suppressedSignals = [],
    token,
    onSignalAckChanged,
  } = props;
  const [localAcknowledged, setLocalAcknowledged] = React.useState<Set<string>>(() => new Set());
  const [investigationSignal, setInvestigationSignal] = React.useState<DashboardSignalItem | null>(null);
  const [showSuppressed, setShowSuppressed] = React.useState(false);
  const suppressedSignalsId = `attention-suppressed-signals-${React.useId().replace(/:/g, "")}`;
  if (isEmpty(props)) return null;

  const openSignals = signals.filter((signal) => {
    const key = signalHistoryKey(signal);
    return !signal.acknowledged && !(key && localAcknowledged.has(key));
  });
  const suppressedTotal = Math.max(0, suppressedSignalCount);
  if (openSignals.length === 0 && suppressedTotal === 0) return null;
  const previewSignals = rankAttentionSignals(openSignals);

  return (
    <>
      <Box>
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
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Attention
            </Typography>
            {suppressedTotal > 0 ? (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {suppressedTotal} suppressed
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  aria-expanded={showSuppressed}
                  aria-controls={suppressedSignalsId}
                  onClick={() => setShowSuppressed((current) => !current)}
                  sx={{ minWidth: 0, p: 0.25, textTransform: "none" }}
                >
                  {showSuppressed ? "Hide" : "Show"} suppressed ({suppressedTotal})
                </Button>
              </>
            ) : null}
          </Box>

          {previewSignals.length > 0 ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              {previewSignals.slice(0, 3).map((signal, idx) => {
                const actionableSignal = signalWithHistoryKey(signal);
                const calculated = signalCalculatedText(signal);
                const meta = signalMetaText(signal, true);
                return (
                  <Box
                    key={`${signal.signalType || signal.kind}-${signal.name || idx}`}
                    data-testid="attention-signal-row"
                    data-signal-row
                    sx={{ color: "text.primary", display: "flex", flexDirection: "column", gap: 0.25 }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                      <StatusChip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity || "info"} />
                      <SignalMemoryHint signal={signal} />
                      <Typography component="span" variant="body2">
                        {signal.reason}
                      </Typography>
                      {calculated ? (
                        <Typography component="span" variant="body2" color="text.secondary">
                          {calculated}
                        </Typography>
                      ) : null}
                      {token ? (
                        <SignalActions
                          token={token}
                          signal={actionableSignal}
                          onInvestigate={setInvestigationSignal}
                          onAckChanged={(acknowledged) => {
                            const key = signalHistoryKey(actionableSignal);
                            if (key) {
                              setLocalAcknowledged((current) => {
                                const next = new Set(current);
                                if (acknowledged) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }
                            onSignalAckChanged?.();
                          }}
                        />
                      ) : null}
                    </Box>
                    {meta ? (
                      <Typography variant="caption" color="text.secondary">
                        {meta}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
              {previewSignals.length > 3 ? (
                <Typography variant="caption" color="text.secondary">
                  +{previewSignals.length - 3} more signal{previewSignals.length - 3 === 1 ? "" : "s"}
                </Typography>
              ) : null}
            </Box>
          ) : null}

          {showSuppressed && suppressedTotal > 0 ? (
            <Box
              id={suppressedSignalsId}
              sx={{ borderTop: "1px solid var(--chip-warning-border)", pt: 1, display: "flex", flexDirection: "column", gap: 0.75 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Suppressed signals
              </Typography>
              {suppressedTotal > suppressedSignals.length ? (
                <Typography variant="caption" color="text.secondary">
                  Showing {suppressedSignals.length} of {suppressedTotal} suppressed.
                </Typography>
              ) : null}
              {suppressedSignals.map((signal, idx) => {
                const actionableSignal = signalWithHistoryKey(signal);
                const expires = suppressionExpiryLabel(signal);
                const comment = signal.suppression?.comment?.trim();
                return (
                  <Box
                    key={`${signal.historyKey || ""}/${signal.kind}/${signal.namespace || ""}/${signal.name || idx}/${signal.reason}`}
                    data-testid="attention-suppressed-signal-row"
                    sx={{ color: "text.primary", display: "flex", flexDirection: "column", gap: 0.25 }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                      <StatusChip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity || "info"} />
                      <Typography component="span" variant="caption" color="text.secondary">
                        {signalKindLabel(signal)}
                      </Typography>
                      <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                        {signalTargetLabel(signal)}
                      </Typography>
                      <Typography component="span" variant="body2">
                        {signal.reason}
                      </Typography>
                      {token ? (
                        <SignalActions token={token} signal={actionableSignal} onInvestigate={setInvestigationSignal} />
                      ) : null}
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                      <Typography component="span" variant="caption" color="text.secondary">
                        {suppressionModeLabel(signal)}
                      </Typography>
                      {expires ? (
                        <Typography component="span" variant="caption" color="text.secondary">
                          Expires {expires}
                        </Typography>
                      ) : null}
                      {comment ? (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          Comment: {comment}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : null}
        </Box>
      </Box>
      {token ? (
        <SignalInvestigationDialog
          token={token}
          signal={investigationSignal}
          onClose={() => setInvestigationSignal(null)}
        />
      ) : null}
    </>
  );
}
