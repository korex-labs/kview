import React from "react";
import { Chip, Tooltip } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ResolvedResourceTag } from "../../resourceTags";
import { CHIP_BORDER_RADIUS } from "../../theme/sxTokens";

function readableTextColor(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#111827" : "#ffffff";
}

export default function ResourceTagChip({
  tag,
  size = "small",
  sx,
}: {
  tag: ResolvedResourceTag;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
}) {
  const color = tag.color || "#607d8b";
  const fg = readableTextColor(color);
  const source = tag.source || (tag.inherited ? "inherited" : "direct");
  const Icon = source === "auto" ? AutoAwesomeOutlinedIcon : LocalOfferOutlinedIcon;
  const chip = (
    <Chip
      size={size}
      icon={<Icon />}
      label={tag.name}
      variant={source === "inherited" ? "outlined" : "filled"}
      sx={{
        borderRadius: CHIP_BORDER_RADIUS,
        maxWidth: 160,
        height: size === "small" ? 24 : 30,
        bgcolor: source === "inherited" ? "transparent" : color,
        borderColor: color,
        borderStyle: source === "auto" ? "dashed" : "solid",
        color: source === "inherited" ? color : fg,
        "& .MuiChip-icon": {
          color: source === "inherited" ? color : fg,
          fontSize: size === "small" ? 15 : 17,
        },
        "& .MuiChip-label": {
          px: 0.75,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        ...sx,
      }}
    />
  );
  const title = source === "inherited"
    ? `${tag.name} (inherited from namespace)`
    : source === "auto"
      ? `${tag.name} (auto-tagged by rule)`
      : tag.name;
  return (
    <Tooltip title={title} arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}
