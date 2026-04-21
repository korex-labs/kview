/**
 * Formatting helpers for metric-enriched UI rows. Values stored in the API
 * are canonical numeric forms: milliCPU (int) and raw bytes (int). These
 * helpers render them with operator-friendly units and also expose the
 * threshold colouring used for progress bars and row badges.
 *
 * Percentages are expressed on 0..100 (or slightly higher when usage
 * overshoots limits); callers should clamp for display but preserve the raw
 * value for tooltips so users can see a >100% overshoot directly.
 */

export function formatCPUMilli(milli: number | undefined | null): string {
  if (milli == null || Number.isNaN(milli)) return "";
  if (milli < 1000) return `${Math.round(milli)}m`;
  return `${(milli / 1000).toFixed(milli % 1000 === 0 ? 0 : 2)}`;
}

export function formatMemoryBytes(bytes: number | undefined | null): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${bytes}B`;
  if (abs < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}Ki`;
  if (abs < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}Mi`;
  if (abs < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}Gi`;
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)}Ti`;
}

export function formatPct(pct: number | undefined | null, digits = 0): string {
  if (pct == null || Number.isNaN(pct) || pct <= 0) return "";
  return `${pct.toFixed(digits)}%`;
}

export type UsageSeverity = "normal" | "warn" | "critical";

/**
 * severityForPct maps a usage percentage to a coarse severity bucket used to
 * colour gauges and chips. Thresholds match the dataplane defaults
 * (policy.Metrics.ContainerNearLimitPct = 90, policy.Metrics.NodePressurePct
 * = 85) but callers pass their own thresholds so UI responds to operator
 * overrides in Settings.
 */
export function severityForPct(
  pct: number | undefined | null,
  warnPct = 75,
  critPct = 90,
): UsageSeverity {
  if (pct == null || Number.isNaN(pct)) return "normal";
  if (pct >= critPct) return "critical";
  if (pct >= warnPct) return "warn";
  return "normal";
}
