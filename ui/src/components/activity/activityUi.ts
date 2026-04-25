import type { SxProps, Theme } from "@mui/material/styles";

export const compactTableContainerSx: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  border: "1px solid var(--border-subtle)",
  borderRadius: 1,
};

export const compactTableSx: SxProps<Theme> = {
  "& .MuiTableCell-root": {
    fontSize: "0.75rem",
    fontFamily: "monospace",
  },
  "& .MuiTableHead-root .MuiTableCell-root": {
    backgroundColor: "var(--bg-primary)",
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

export const badgeChipSx: SxProps<Theme> = {
  height: 24,
  fontSize: "0.75rem",
  textTransform: "uppercase",
  borderWidth: 1,
  borderStyle: "solid",
};

type ChipCategory = "kind" | "type" | "status" | "level";
type ChipTone = "default" | "success" | "warning" | "error" | "info" | "primary" | "secondary";

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

const chipToneSx: Record<ChipTone, SxProps<Theme>> = {
  default: {
    color: "var(--chip-default-fg)",
    bgcolor: "var(--chip-default-bg)",
    borderColor: "var(--chip-default-border)",
  },
  success: {
    color: "var(--chip-success-fg)",
    bgcolor: "var(--chip-success-bg)",
    borderColor: "var(--chip-success-border)",
  },
  warning: {
    color: "var(--chip-warning-fg)",
    bgcolor: "var(--chip-warning-bg)",
    borderColor: "var(--chip-warning-border)",
  },
  error: {
    color: "var(--chip-error-fg)",
    bgcolor: "var(--chip-error-bg)",
    borderColor: "var(--chip-error-border)",
  },
  info: {
    color: "var(--chip-info-fg)",
    bgcolor: "var(--chip-info-bg)",
    borderColor: "var(--chip-info-border)",
  },
  primary: {
    color: "var(--chip-primary-fg)",
    bgcolor: "var(--chip-primary-bg)",
    borderColor: "var(--chip-primary-border)",
  },
  secondary: {
    color: "var(--chip-secondary-fg)",
    bgcolor: "var(--chip-secondary-bg)",
    borderColor: "var(--chip-secondary-border)",
  },
};

export function chipSxForValue(value: string, category: ChipCategory = "status"): SxProps<Theme> {
  const tone = chipToneForValue(value, category);
  return [badgeChipSx, chipToneSx[tone]] as SxProps<Theme>;
}
