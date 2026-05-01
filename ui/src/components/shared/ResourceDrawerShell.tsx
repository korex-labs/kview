import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Divider } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  RESOURCE_DRAWER_WIDTH,
  RESOURCE_DRAWER_MIN_WIDTH,
  RESOURCE_DRAWER_MAX_WIDTH,
  RESOURCE_DRAWER_PADDING,
  RESOURCE_DRAWER_HEADER_DIVIDER_MY,
} from "../../constants/drawerTokens";
import { useUserSettings } from "../../settingsContext";

export type ResourceDrawerShellProps = {
  /** Header title (e.g. "Pod: my-pod" or a fragment with chips). */
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Content width in px. Defaults to RESOURCE_DRAWER_WIDTH (820).
   * Use RESOURCE_DRAWER_WIDTH_NARROW (620) for simpler/narrow drawers.
   */
  contentWidth?: number;
};

/**
 * Shared layout shell for resource detail drawers: outer container, header row, divider, and content slot.
 * Use inside RightDrawer so all resource drawers share the same width, padding, and header pattern.
 */
export default function ResourceDrawerShell({
  title,
  onClose,
  children,
  contentWidth = RESOURCE_DRAWER_WIDTH,
}: ResourceDrawerShellProps) {
  const { settings, setSettings } = useUserSettings();
  const [isResizing, setIsResizing] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(contentWidth);
  const nextWidthRef = useRef(contentWidth);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const maxWidth = useMemo(
    () => Math.max(RESOURCE_DRAWER_MIN_WIDTH, Math.min(RESOURCE_DRAWER_MAX_WIDTH, window.innerWidth - 120)),
    [],
  );

  const clampWidth = useCallback((value: number) => {
    if (!Number.isFinite(value)) return RESOURCE_DRAWER_WIDTH;
    const rounded = Math.round(value);
    return Math.max(RESOURCE_DRAWER_MIN_WIDTH, Math.min(maxWidth, rounded));
  }, [maxWidth]);

  const [drawerWidth, setDrawerWidth] = useState(() => clampWidth(settings.appearance.resourceDrawerWidthPx || contentWidth));

  useEffect(() => {
    if (isResizing) return;
    setDrawerWidth(clampWidth(settings.appearance.resourceDrawerWidthPx || contentWidth));
  }, [clampWidth, contentWidth, isResizing, settings.appearance.resourceDrawerWidthPx]);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      const delta = dragStartXRef.current - e.clientX;
      const next = clampWidth(dragStartWidthRef.current + delta);
      nextWidthRef.current = next;
      setDrawerWidth(next);
    };

    const onUp = () => {
      setIsResizing(false);
      const next = nextWidthRef.current;
      setSettings((prev) => {
        if (prev.appearance.resourceDrawerWidthPx === next) return prev;
        return {
          ...prev,
          appearance: {
            ...prev.appearance,
            resourceDrawerWidthPx: next,
          },
        };
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clampWidth, isResizing, setSettings]);

  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  return (
    <Box
      ref={shellRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      sx={{
        outline: "none",
        width: drawerWidth,
        p: RESOURCE_DRAWER_PADDING,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      <Box
        onMouseDown={(e) => {
          e.preventDefault();
          dragStartXRef.current = e.clientX;
          dragStartWidthRef.current = drawerWidth;
          nextWidthRef.current = drawerWidth;
          setIsResizing(true);
        }}
        sx={{
          position: "absolute",
          left: -4,
          top: 0,
          width: 8,
          height: "100%",
          cursor: "ew-resize",
          zIndex: 1,
        }}
      />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider sx={{ my: RESOURCE_DRAWER_HEADER_DIVIDER_MY }} />

      {children}
    </Box>
  );
}
