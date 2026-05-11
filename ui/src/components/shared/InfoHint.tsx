import React from "react";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { AppIconButton } from "./AppActions";

export default function InfoHint({ title }: { title: string }) {
  return (
    <AppIconButton tooltip={title} label="More information" sx={{ p: 0.25 }}>
      <InfoOutlinedIcon fontSize="inherit" />
    </AppIconButton>
  );
}
