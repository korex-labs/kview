import React, { useEffect, useState } from "react";
import { Drawer, type DrawerProps } from "@mui/material";

type Props = DrawerProps;

let openedRightDrawers = 0;

export default function RightDrawer(props: Props) {
  const { PaperProps, ModalProps, ...rest } = props;
  const [drawerDepth, setDrawerDepth] = useState(0);

  useEffect(() => {
    if (!props.open) return;
    openedRightDrawers += 1;
    setDrawerDepth(openedRightDrawers);
    return () => {
      openedRightDrawers = Math.max(0, openedRightDrawers - 1);
      setDrawerDepth(0);
    };
  }, [props.open]);

  return (
    <Drawer
      anchor="right"
      {...rest}
      ModalProps={{
        // Allow focus to move from an opened drawer to Activity Panel xterm.
        disableEnforceFocus: true,
        disableAutoFocus: true,
        disableRestoreFocus: true,
        hideBackdrop: ModalProps?.hideBackdrop ?? drawerDepth > 1,
        ...ModalProps,
      }}
      PaperProps={{
        sx: {
          // AppBar is 64px (mt: 8), keep drawer below it.
          // Subtract dynamic bottom panel offset; when panel is collapsed this is small,
          // when expanded it is larger, so the drawer never hides behind it.
          mt: 8,
          height: "calc(100% - 64px - var(--bottom-panel-offset, 0px))",
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
          ...(PaperProps?.sx || {}),
        },
        ...PaperProps,
      }}
    />
  );
}

