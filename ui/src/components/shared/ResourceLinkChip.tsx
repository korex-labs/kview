import React from "react";
import { Chip, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ChipColor } from "../../utils/k8sUi";
import { ScopedCountContent, scopedCountChipSx } from "./ScopedCountChip";

type ResourceLinkChipProps = {
  label: string;
  count?: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  sx?: SxProps<Theme>;
  color?: ChipColor | "primary";
  title?: string;
};

export default function ResourceLinkChip({ label, count, onClick, sx, color, title }: ResourceLinkChipProps) {
  const clickable = !!onClick;
  const chipColor = color || (clickable ? "primary" : "default");
  const variant = clickable ? "outlined" : "filled";
  const countText = typeof count === "string" || typeof count === "number" ? String(count) : "";
  const tooltipTitle = title || (countText ? `${label}: ${countText}` : label);
  const rootSx = { minWidth: 0, maxWidth: "100%", textTransform: "none", ...sx };
  const chip = (
    <Chip
      size="small"
      variant={variant}
      color={count === undefined ? chipColor : undefined}
      label={count === undefined ? label : <ScopedCountContent label={label} count={count} size="small" />}
      onClick={onClick}
      clickable={clickable}
      sx={count === undefined ? rootSx : scopedCountChipSx(chipColor, variant, "default", rootSx)}
    />
  );
  if (!tooltipTitle) return chip;
  return (
    <Tooltip title={tooltipTitle} arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}
