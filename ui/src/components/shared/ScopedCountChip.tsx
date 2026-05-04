import React from "react";
import { Box, Chip, Tooltip } from "@mui/material";
import type { ChipProps } from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";
import { CHIP_BORDER_RADIUS } from "../../theme/sxTokens";
import OverflowTooltip from "./OverflowTooltip";

export type ScopedCountChipColor = "default" | "primary" | "secondary" | "success" | "warning" | "error" | "info";

type ScopedCountChipSize = NonNullable<ChipProps["size"]>;
type ScopedCountChipDensity = "default" | "compact" | "toolbar";

export type ScopedCountChipProps = {
  label: string;
  count: React.ReactNode;
  color?: ScopedCountChipColor;
  size?: ChipProps["size"];
  density?: ScopedCountChipDensity;
  variant?: ChipProps["variant"];
  onClick?: ChipProps["onClick"];
  clickable?: boolean;
  disabled?: ChipProps["disabled"];
  sx?: SxProps<Theme>;
  title?: string;
};

export function activeChipSx(color: ScopedCountChipColor): SxProps<Theme> {
  return {
    "--scoped-chip-bg": `var(--chip-${color}-active-bg)`,
    "--scoped-chip-fg": `var(--chip-${color}-active-fg)`,
    "--scoped-chip-border": `var(--chip-${color}-active-border)`,
    border: "2px solid var(--scoped-chip-border)",
  } as SxProps<Theme>;
}

export function scopedCountToneVars(color: ScopedCountChipColor) {
  const tone = color || "default";
  return {
    "--scoped-chip-bg": `var(--chip-${tone}-bg)`,
    "--scoped-chip-fg": `var(--chip-${tone}-fg)`,
    "--scoped-chip-border": `var(--chip-${tone}-border)`,
  } as React.CSSProperties;
}

export function ScopedCountContent({
  label,
  count,
  size,
  density = "default",
}: {
  label: string;
  count: React.ReactNode;
  size: ScopedCountChipSize;
  density?: ScopedCountChipDensity;
}) {
  const compact = density === "compact";
  const toolbar = density === "toolbar";
  const countTitle = typeof count === "string" || typeof count === "number" ? String(count) : "";
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "stretch", minWidth: 0, maxWidth: "100%", height: "100%" }}>
      <Box
        component="span"
        sx={{
          backgroundColor: "var(--scoped-chip-bg)",
          color: "var(--scoped-chip-fg)",
          px: compact ? 0.5 : toolbar ? 1.125 : size === "small" ? 0.875 : 1,
          py: compact ? 0.125 : 0,
          fontWeight: 600,
          fontSize: compact ? "0.75rem" : undefined,
          lineHeight: compact ? 1.2 : undefined,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <OverflowTooltip title={label}>{label}</OverflowTooltip>
      </Box>
      <Box
        component="span"
        sx={{
          backgroundColor: "var(--chip-scoped-count-bg)",
          color: "var(--chip-scoped-count-fg)",
          borderLeft: "1px solid var(--chip-scoped-count-border)",
          px: compact ? 0.375 : toolbar ? 0.875 : size === "small" ? 0.625 : 0.75,
          py: compact ? 0.125 : 0,
          fontWeight: 700,
          fontSize: compact ? "0.75rem" : undefined,
          lineHeight: compact ? 1.2 : undefined,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {countTitle ? <OverflowTooltip title={countTitle}>{countTitle}</OverflowTooltip> : count}
      </Box>
    </Box>
  );
}

function sizeHeight(size: ChipProps["size"]): number {
  return size === "medium" ? 32 : 24;
}

export function scopedCountChipSx(
  color: ScopedCountChipColor,
  variant: NonNullable<ChipProps["variant"]>,
  density: ScopedCountChipDensity,
  sx?: SxProps<Theme>,
  size: ChipProps["size"] = "small",
): SxProps<Theme> {
  const compact = density === "compact";
  const toolbar = density === "toolbar";
  return {
    ...scopedCountToneVars(color),
    borderRadius: CHIP_BORDER_RADIUS,
    overflow: "hidden",
    border: "1px solid var(--scoped-chip-border)",
    backgroundColor: variant === "outlined" ? "transparent" : "var(--scoped-chip-bg)",
    color: "var(--scoped-chip-fg)",
    height: compact ? 22 : toolbar ? 32 : sizeHeight(size),
    padding: 0,
    minWidth: 0,
    maxWidth: "100%",
    "& .MuiChip-label": {
      display: "flex",
      padding: 0,
      overflow: "hidden",
      height: "100%",
      minWidth: 0,
      maxWidth: "100%",
    },
    "&:hover": {
      backgroundColor: variant === "outlined" ? "var(--scoped-chip-bg)" : undefined,
    },
    ...sx,
  };
}

export default function ScopedCountChip({
  label,
  count,
  color = "default",
  size = "small",
  density = "default",
  variant = "filled",
  onClick,
  clickable,
  disabled,
  sx,
  title,
}: ScopedCountChipProps) {
  const chip = (
    <Chip
      size={size}
      variant={variant}
      label={(
        <ScopedCountContent label={label} count={count} size={size} density={density} />
      )}
      onClick={onClick}
      clickable={clickable ?? !!onClick}
      disabled={disabled}
      sx={scopedCountChipSx(color, variant, density, sx, size)}
    />
  );

  if (!title) return chip;
  return (
    <Tooltip title={title} arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}
