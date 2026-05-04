import type { SxProps, Theme } from "@mui/material/styles";
import type { ChipProps } from "@mui/material/Chip";

export const compactTableContainerSx: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  borderTop: "1px solid var(--border-subtle)",
  borderRadius: 0,
};

export const compactTableSx: SxProps<Theme> = {
  "& .MuiTableCell-root": {
    fontSize: "0.75rem",
  },
  "& .MuiTableHead-root .MuiTableCell-root": {
    backgroundColor: "var(--bg-primary)",
  },
  "& .MuiTableRow-root": {
    transition: "opacity 700ms ease, background-color 700ms ease",
  },
  "& .MuiTableRow-root[data-exiting='true']": {
    opacity: 0,
  },
};

export const compactHeaderCellSx: SxProps<Theme> = {
  fontSize: "0.72rem",
  fontWeight: 600,
  py: 0.5,
};

export const compactCellSx: SxProps<Theme> = {
  py: 0.45,
  verticalAlign: "top",
};

export const activityChipSx: SxProps<Theme> = {
  height: 22,
  fontSize: "0.72rem",
  "& .MuiChip-label": { px: 0.8 },
};

type ChipCategory = "kind" | "type" | "status" | "level";
type ChipTone = NonNullable<ChipProps["color"]>;

export const panelEmptyStateSx: SxProps<Theme> = {
  color: "text.secondary",
  fontFamily: "monospace",
  fontSize: "0.75rem",
  textAlign: "center",
  border: "1px dashed var(--border-subtle)",
  borderRadius: 1,
  py: 1.25,
  px: 1,
};

function genericChipTone(value: string): ChipTone {
  switch ((value || "").toLowerCase()) {
    case "error":
    case "fatal":
    case "panic":
    case "failed":
    case "disconnected":
    case "terminated":
    case "denied":
      return "error";
    case "warn":
    case "warning":
    case "degraded":
    case "retrying":
    case "timeout":
    case "stopping":
      return "warning";
    case "running":
    case "active":
    case "connected":
    case "success":
    case "created":
    case "ready":
      return "success";
    case "starting":
    case "pending":
    case "info":
    case "opening":
    case "created_pending":
      return "info";
    case "terminal":
      return "info";
    case "portforward":
      return "secondary";
    case "session":
    case "runtime":
    case "worker":
      return "primary";
    case "namespace-list-enrich":
    case "dataplane-snapshot":
    case "connectivity":
      return "info";
    case "rbac":
      return "warning";
    default:
      return "default";
  }
}

export function chipToneForValue(value: string, category: ChipCategory = "status"): ChipTone {
  const normalized = (value || "").toLowerCase();

  if (category === "kind") {
    if (normalized === "terminal") return "info";
    if (normalized === "portforward") return "secondary";
    if (normalized === "runtime") return "primary";
    if (normalized === "worker") return "primary";
    if (normalized === "rbac") return "warning";
  }

  if (category === "type") {
    if (normalized.includes("create") || normalized.includes("open") || normalized.includes("start")) {
      return "success";
    }
    if (normalized.includes("close") || normalized.includes("delete") || normalized.includes("stop")) {
      return "warning";
    }
  }

  return genericChipTone(normalized);
}

export function chipColorForValue(value: string, category: ChipCategory = "status"): ChipProps["color"] {
  return chipToneForValue(value, category);
}
