import React from "react";
import { Box } from "@mui/material";
import type { DashboardSignalItem } from "../../types/api";
import SignalAckButton from "./SignalAckButton";
import SignalInvestigationButton from "./SignalInvestigationButton";
import SignalSuppressionButton from "./SignalSuppressionButton";
import { QuickSignalExclusionButton } from "./QuickSignalExclusion";

type Props = {
  token?: string;
  signal: DashboardSignalItem;
  onInvestigate: (signal: DashboardSignalItem) => void;
  onAckChanged?: (acknowledged: boolean) => void;
  onSuppressionChanged?: () => void;
};

export default function SignalActions({ token, signal, onInvestigate, onAckChanged, onSuppressionChanged }: Props) {
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
      <QuickSignalExclusionButton signal={signal} />
      {token ? <SignalSuppressionButton token={token} signal={signal} onChanged={onSuppressionChanged} /> : null}
    </Box>
  );
}
