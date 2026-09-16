import React from "react";
import { AppButton } from "./AppActions";
import DataplaneExplanationDialog from "./DataplaneExplanationDialog";
import type { DataplaneExplanationSurface } from "./dataplaneExplanationModel";

type Props = {
  token: string;
  activeContext: string;
  surface: DataplaneExplanationSurface;
};

/** Shared compact action for opening a lazy, exact-context dataplane explanation. */
export default function DataplaneExplanationAction({ token, activeContext, surface }: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <AppButton
        variant="outlined"
        onClick={() => setOpen(true)}
        sx={{
          minWidth: 0,
          px: 1,
          py: 0,
          height: 24,
          minHeight: 24,
          maxHeight: 24,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        Explain
      </AppButton>
      <DataplaneExplanationDialog
        open={open}
        onClose={() => setOpen(false)}
        token={token}
        activeContext={activeContext}
        surface={surface}
      />
    </>
  );
}
