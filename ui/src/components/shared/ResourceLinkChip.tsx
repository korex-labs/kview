import React from "react";
import { Chip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

type ResourceLinkChipProps = {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  sx?: SxProps<Theme>;
};

export default function ResourceLinkChip({ label, onClick, sx }: ResourceLinkChipProps) {
  const clickable = !!onClick;
  return (
    <Chip
      size="small"
      variant={clickable ? "outlined" : "filled"}
      color={clickable ? "primary" : "default"}
      label={label}
      onClick={onClick}
      clickable={clickable}
      sx={{ textTransform: "none", ...sx }}
    />
  );
}
