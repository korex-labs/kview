import React from "react";
import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

type DrawerActionStripProps = {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
};

export default function DrawerActionStrip({ children, sx }: DrawerActionStripProps) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 1,
        flexWrap: "wrap",
        width: "100%",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
