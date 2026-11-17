import React from "react";
import SignalHistoryPanel, { type SignalHistoryProps } from "./SignalHistoryPanel";

type HistoryProps = SignalHistoryProps & { active: boolean };
export default function DashboardHistoryTab({ token, context, active, ...selection }: HistoryProps) {
  // Unmount hidden work and remount before painting a new request identity.
  return active ? <SignalHistoryPanel key={JSON.stringify([context, token])} token={token} context={context} {...selection} /> : null;
}
