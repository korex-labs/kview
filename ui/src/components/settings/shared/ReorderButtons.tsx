import React from "react";
import { Box } from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import { AppIconButton } from "../../shared/AppActions";

type Props = {
  label: string;
  index: number;
  lastIndex: number;
  onUp: () => void;
  onDown: () => void;
  onRemove?: () => void;
};

export default function ReorderButtons({ label, index, lastIndex, onUp, onDown, onRemove }: Props) {
  return (
    <Box sx={{ display: "flex", gap: 0.25 }}>
      <AppIconButton tooltip={`Move ${label} up`} label={`Move ${label} up`} onClick={onUp} disabled={index === 0}>
        <ArrowUpwardIcon fontSize="inherit" />
      </AppIconButton>
      <AppIconButton tooltip={`Move ${label} down`} label={`Move ${label} down`} onClick={onDown} disabled={index === lastIndex}>
        <ArrowDownwardIcon fontSize="inherit" />
      </AppIconButton>
      {onRemove ? (
        <AppIconButton tooltip={`Remove ${label}`} label={`Remove ${label}`} intent="destructive" onClick={onRemove}>
          <DeleteOutlineIcon fontSize="inherit" />
        </AppIconButton>
      ) : null}
    </Box>
  );
}
