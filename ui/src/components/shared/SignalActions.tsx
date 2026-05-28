import React from "react";
import { Box } from "@mui/material";
import type { DashboardSignalItem } from "../../types/api";
import SignalAckButton from "./SignalAckButton";
import SignalInvestigationButton from "./SignalInvestigationButton";

type Props = {
  token?: string;
  signal: DashboardSignalItem;
  onInvestigate: (signal: DashboardSignalItem) => void;
  onAckChanged?: (acknowledged: boolean) => void;
};

export default function SignalActions({ token, signal, onInvestigate, onAckChanged }: Props) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.25,
        flex: "0 0 auto",
        flexWrap: "nowrap",
        whiteSpace: "nowrap",
      }}
    >
      {token ? <SignalAckButton token={token} signal={signal} onChanged={onAckChanged} /> : null}
      <SignalInvestigationButton signal={signal} onInvestigate={onInvestigate} />
    </Box>
  );
}
