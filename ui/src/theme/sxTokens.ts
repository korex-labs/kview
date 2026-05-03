/**
 * Shared MUI sx style tokens to reduce repeated inline styles.
 * Use these for layout/structural patterns that repeat across drawers, tables, and shared components.
 * Theme-sensitive colors use CSS variables from theme.css.
 */

import type { SxProps, Theme } from "@mui/material/styles";

// ---- Panel / key-value box ----
/** Panel with border and padding; used for KeyValueTable wrappers, event cards, etc. */
export const panelBoxSx: SxProps<Theme> = {
  border: "1px solid var(--panel-border)",
  borderRadius: 2,
  p: 1.5,
  ".KviewSectionContent > &": {
    border: 0,
    borderRadius: 0,
    p: 0,
  },
};

/** Tighter panel padding (e.g. event list items). */
export const panelBoxCompactSx: SxProps<Theme> = {
  border: "1px solid var(--panel-border)",
  borderRadius: 2,
  p: 1.25,
};

// ---- Drawer layout ----
/** Main content area below drawer header/tabs: fills space and scrolls. */
export const drawerBodySx: SxProps<Theme> = {
  mt: 2,
  flexGrow: 1,
  minHeight: 0,
  overflow: "hidden",
};

/** Tab content column: scrollable flex column with standard gap. */
export const drawerTabContentSx: SxProps<Theme> = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  height: "100%",
  overflowY: "auto",
  overflowX: "hidden",
};

/** Tab content column with smaller gap (accordions, dense content). */
export const drawerTabContentCompactSx: SxProps<Theme> = {
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
  height: "100%",
  overflowY: "auto",
  overflowX: "hidden",
};

/** Centered loading spinner container (e.g. drawer loading state). */
export const loadingCenterSx: SxProps<Theme> = {
  display: "flex",
  justifyContent: "center",
  mt: 4,
};

// ---- Typography / values ----
/** Monospace text for names, keys, code-like values. */
export const monospaceSx: SxProps<Theme> = {
  fontFamily: "monospace",
};

// ---- Metric / gauge layout ----
/** Height in px for gauge and stacked bar components. */
export const GAUGE_HEIGHT = 20;
/** Border-radius for gauge and bar components (slightly rounded, squared look). */
export const GAUGE_BORDER_RADIUS = "4px";
/** Border-radius for compact telemetry chips; aligned with gauges. */
export const CHIP_BORDER_RADIUS = GAUGE_BORDER_RADIUS;
/** Background color for empty gauge track. */
export const GAUGE_TRACK_BG = "var(--gauge-track-bg)";
/** Min-width for MetricCard components in a flex row. */
export const METRIC_CARD_MIN_WIDTH = 160;
/** Label column width in two-column stat tables (e.g. DashboardView StatCell). */
export const STAT_CELL_LABEL_WIDTH = 240;

// ---- Gauge / health segment colors ----
/** Healthy, running, cache hit, nominal state. */
export const GAUGE_COLOR_HEALTHY = "var(--gauge-success-fill)";
/** Progressing, pending, cache miss, degraded-but-not-failed. */
export const GAUGE_COLOR_WARNING = "var(--gauge-warning-fill)";
/** Failed, degraded, error. */
export const GAUGE_COLOR_ERROR = "var(--gauge-error-fill)";
/** Completed / succeeded (terminal-ok) state. */
export const GAUGE_COLOR_NEUTRAL = "var(--gauge-neutral-fill)";
/** Unknown state. */
export const GAUGE_COLOR_UNKNOWN = "var(--gauge-unknown-fill)";

// ---- Toolbar / action row ----
/** Horizontal action row: flex, wrap, gap 1. */
export const actionRowSx: SxProps<Theme> = {
  display: "flex",
  gap: 1,
  flexWrap: "wrap",
};
