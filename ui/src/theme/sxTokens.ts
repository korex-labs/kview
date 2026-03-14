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
  overflow: "auto",
};

/** Tab content column with smaller gap (accordions, dense content). */
export const drawerTabContentCompactSx: SxProps<Theme> = {
  display: "flex",
  flexDirection: "column",
  gap: 1.5,
  height: "100%",
  overflow: "auto",
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

// ---- Toolbar / action row ----
/** Horizontal action row: flex, wrap, gap 1. */
export const actionRowSx: SxProps<Theme> = {
  display: "flex",
  gap: 1,
  flexWrap: "wrap",
};
