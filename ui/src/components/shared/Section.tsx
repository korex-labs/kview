import React from "react";
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { panelBoxSx } from "../../theme/sxTokens";

type SectionProps = {
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  divider?: boolean;
  dividerPlacement?: "title" | "content";
  variant?: "panel" | "plain";
  sx?: SxProps<Theme>;
  headerSx?: SxProps<Theme>;
};

export default function Section({
  title,
  children,
  actions,
  divider = false,
  dividerPlacement = "title",
  variant = "panel",
  sx,
  headerSx,
}: SectionProps) {
  const framedSx: SxProps<Theme> = variant === "panel" ? panelBoxSx : {};
  const contentSpacing = dividerPlacement === "content" ? 1 : 1.25;

  return (
    <Box sx={[framedSx, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: contentSpacing,
          flexWrap: "wrap",
          ...headerSx,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {actions ? <Box sx={{ ml: "auto" }}>{actions}</Box> : null}
      </Box>
      <Box
        className="KviewSectionContent"
        sx={
          divider
            ? {
                borderTop: "1px solid var(--panel-border)",
                pt: 1,
              }
            : undefined
        }
      >
        {children}
      </Box>
    </Box>
  );
}
