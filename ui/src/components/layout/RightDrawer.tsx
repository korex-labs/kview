import React, { useEffect, useRef, useState } from "react";
import { Drawer, type DrawerProps } from "@mui/material";

type Props = DrawerProps;

type RightDrawerStackEntry = {
  id: number;
  onCloseRef: React.MutableRefObject<Props["onClose"]>;
};

let nextRightDrawerId = 1;
const rightDrawerStack: RightDrawerStackEntry[] = [];
let escapeListenerRegistered = false;

function isOverlayEscapeTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    ".MuiAutocomplete-popper",
    ".MuiMenu-root",
    ".MuiPopover-root",
    ".MuiDialog-root",
    "[role='dialog']",
    "[role='menu']",
    "[role='listbox']",
  ].join(","));
}

function onRightDrawerEscape(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== "Escape" || isOverlayEscapeTarget(event.target)) return;
  const top = rightDrawerStack[rightDrawerStack.length - 1];
  const onClose = top?.onCloseRef.current;
  if (!onClose) return;
  event.preventDefault();
  event.stopPropagation();
  onClose(event, "escapeKeyDown");
}

function syncEscapeListener() {
  if (rightDrawerStack.length && !escapeListenerRegistered) {
    window.addEventListener("keydown", onRightDrawerEscape);
    escapeListenerRegistered = true;
    return;
  }
  if (!rightDrawerStack.length && escapeListenerRegistered) {
    window.removeEventListener("keydown", onRightDrawerEscape);
    escapeListenerRegistered = false;
  }
}

export default function RightDrawer(props: Props) {
  const { PaperProps, ModalProps, ...rest } = props;
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
        disableEscapeKeyDown: true,
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
