import React from "react";
import { Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { valueOrDash } from "../../utils/format";
import { monospaceSx } from "../../theme/sxTokens";

type KeyValueRow = {
  label: string;
  value?: React.ReactNode;
  monospace?: boolean;
  valueSx?: SxProps<Theme>;
};

type KeyValueTableProps = {
  rows: KeyValueRow[];
  columns?: number;
  sx?: SxProps<Theme>;
  valueSx?: SxProps<Theme>;
};

export default function KeyValueTable({
  rows,
  columns = 3,
  sx,
  valueSx,
}: KeyValueTableProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 1.5,
        ...sx,
      }}
    >
      {rows.map((row) => {
        const isEmpty = row.value === undefined || row.value === null || row.value === "";
        const displayValue = isEmpty ? valueOrDash(row.value as string | number | null | undefined) : row.value;
        const sharedValueSx = {
          ...(row.monospace ? monospaceSx : {}),
          ...(valueSx || {}),
          ...(row.valueSx || {}),
        };

        return (
          <Box key={row.label}>
            <Typography variant="caption" color="text.secondary" display="block">
              {row.label}
            </Typography>
            {React.isValidElement(displayValue) ? (
              displayValue
            ) : (
              <Typography variant="body2" sx={sharedValueSx}>
                {displayValue}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
