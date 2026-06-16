import React, { useEffect, useMemo, useRef, useState } from "react";
import { Drawer, type DrawerProps } from "@mui/material";
import { useKeyboardScope, type KeyboardFocusScope } from "../../keyboard/KeyboardProvider";

type Props = DrawerProps;

type RightDrawerStackEntry = {
  id: number;
  onCloseRef: React.MutableRefObject<Props["onClose"]>;
};

let nextRightDrawerId = 1;
const rightDrawerStack: RightDrawerStackEntry[] = [];

export default function RightDrawer(props: Props) {
  const { ModalProps, slotProps, onClose, ...rest } = props;
  const [drawerDepth, setDrawerDepth] = useState(0);
  const [keyboardScopeId, setKeyboardScopeId] = useState("");
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
    setKeyboardScopeId(`right-drawer-${entry.id}`);
    return () => {
      const index = rightDrawerStack.findIndex((item) => item.id === entry.id);
      if (index >= 0) rightDrawerStack.splice(index, 1);
      setDrawerDepth(0);
      setKeyboardScopeId("");
    };
  }, [hasOnClose, props.open]);

  const keyboardScope: KeyboardFocusScope | null = useMemo(() => (
    props.open && hasOnClose && keyboardScopeId
      ? {
          id: keyboardScopeId,
          label: "Right drawer",
          kind: "drawer",
          suppressGlobalShortcuts: true,
          onEscape: (event) => {
            const onClose = onCloseRef.current;
            if (!onClose) return false;
            onClose(event, "escapeKeyDown");
            return true;
          },
        }
      : null
  ), [hasOnClose, keyboardScopeId, props.open]);
  useKeyboardScope(keyboardScope);

  return (
    <Drawer
      anchor="right"
      {...rest}
      onClose={(event, reason) => {
        onClose?.(event, reason);
      }}
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
