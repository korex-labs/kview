import React, { useEffect, useRef, useState } from "react";
import { Drawer, type DrawerProps } from "@mui/material";
import { isKeyboardOwnedOverlayTarget } from "../../keyboard/keyboardUtils";

type Props = DrawerProps;

type RightDrawerStackEntry = {
  id: number;
  onCloseRef: React.MutableRefObject<Props["onClose"]>;
};

let nextRightDrawerId = 1;
const rightDrawerStack: RightDrawerStackEntry[] = [];
let escapeListenerRegistered = false;

function onRightDrawerEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || isKeyboardOwnedOverlayTarget(event.target)) return;
  const top = rightDrawerStack[rightDrawerStack.length - 1];
  const onClose = top?.onCloseRef.current;
  if (!onClose) return;
  event.preventDefault();
  event.stopPropagation();
  onClose(event, "escapeKeyDown");
}

function syncEscapeListener() {
  if (rightDrawerStack.length && !escapeListenerRegistered) {
    window.addEventListener("keydown", onRightDrawerEscape, true);
    escapeListenerRegistered = true;
    return;
  }
  if (!rightDrawerStack.length && escapeListenerRegistered) {
    window.removeEventListener("keydown", onRightDrawerEscape, true);
    escapeListenerRegistered = false;
  }
}

export default function RightDrawer(props: Props) {
  const { ModalProps, slotProps, ...rest } = props;
  const [drawerDepth, setDrawerDepth] = useState(0);
  const onCloseRef = useRef(props.onClose);
  const hasOnClose = !!props.onClose;

  onCloseRef.current = props.onClose;

  useEffect(() => {
    if (!props.open || !hasOnClose) return;
    const entry = {
      id: nextRightDrawerId,
      onCloseRef,
    };
    nextRightDrawerId += 1;
    rightDrawerStack.push(entry);
    setDrawerDepth(rightDrawerStack.length);
    syncEscapeListener();
    return () => {
      const index = rightDrawerStack.findIndex((item) => item.id === entry.id);
      if (index >= 0) rightDrawerStack.splice(index, 1);
      setDrawerDepth(0);
      syncEscapeListener();
    };
  }, [hasOnClose, props.open]);

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
      slotProps={{
        ...slotProps,
        paper: {
          ...slotProps?.paper,
          sx: {
          // AppBar is 64px (mt: 8), keep drawer below it.
          // Subtract dynamic bottom panel offset; when panel is collapsed this is small,
          // when expanded it is larger, so the drawer never hides behind it.
            mt: 8,
            height: "calc(100% - 64px - var(--bottom-panel-offset, 0px))",
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
            ...(typeof slotProps?.paper === "object" && "sx" in slotProps.paper ? slotProps.paper.sx : {}),
          },
        },
      }}
    />
  );
}
