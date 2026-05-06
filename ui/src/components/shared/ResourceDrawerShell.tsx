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
import { useKeyboardControls, type ContextualKeyboardAction } from "../../keyboard/KeyboardProvider";
import ResourceIcon from "../icons/resources/ResourceIcon";
import type { ResourceIconName } from "../icons/resources/types";

export type ResourceDrawerShellProps = {
  /** Header title (e.g. "Pod: my-pod" or a fragment with chips). */
  title: React.ReactNode;
  resourceIcon?: ResourceIconName;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Content width in px. Defaults to RESOURCE_DRAWER_WIDTH (820).
   * Use RESOURCE_DRAWER_WIDTH_NARROW (620) for simpler/narrow drawers.
   */
  contentWidth?: number;
};

const tabShortcutBindings: Record<string, string> = {
  overview: "o",
  signals: "s",
  containers: "c",
  resources: "u",
  networking: "n",
  events: "v",
  logs: "l",
  metadata: "m",
  yaml: "y",
  pods: "p",
  spec: "x",
  keys: "k",
  rules: "u",
  tls: "t",
  versions: "b",
  namespaces: "n",
  conditions: "c",
  inventory: "i",
  capacity: "a",
  subjects: "b",
  "role bindings": "b",
  "role ref": "f",
  jobs: "j",
};

function normalizedControlText(el: HTMLElement): string {
  return (el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isUsableControl(el: HTMLElement): boolean {
  return !el.getAttribute("aria-disabled") && !("disabled" in el && Boolean((el as HTMLButtonElement).disabled));
}

/**
 * Shared layout shell for resource detail drawers: outer container, header row, divider, and content slot.
 * Use inside RightDrawer so all resource drawers share the same width, padding, and header pattern.
 */
export default function ResourceDrawerShell({
  title,
  resourceIcon,
  onClose,
  children,
  contentWidth = RESOURCE_DRAWER_WIDTH,
}: ResourceDrawerShellProps) {
  const { settings, setSettings } = useUserSettings();
  const { registerContextActions } = useKeyboardControls();
  const [isResizing, setIsResizing] = useState(false);
  const [actionRevision, setActionRevision] = useState(0);
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

  const clickDrawerControl = useCallback((predicate: (el: HTMLElement) => boolean) => {
    const root = shellRef.current;
    if (!root) return false;
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button,[role='tab']"));
    const control = controls.find((el) => isUsableControl(el) && predicate(el));
    control?.click();
    return !!control;
  }, []);

  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const bump = () => setActionRevision((v) => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-disabled", "disabled", "role"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = shellRef.current;
    const actions: ContextualKeyboardAction[] = [];

    const tabs = Array.from(root?.querySelectorAll<HTMLElement>("[role='tab']") || [])
      .filter(isUsableControl)
      .map((el) => normalizedControlText(el))
      .filter(Boolean);
    const usedBindings = new Set(actions.map((action) => action.binding.join(" ")));
    for (const tabLabel of tabs) {
      const binding = tabShortcutBindings[tabLabel];
      if (!binding || usedBindings.has(binding)) continue;
      usedBindings.add(binding);
      actions.push({
        id: `drawer.tab.${tabLabel}`,
        label: `Open ${tabLabel.replace(/\b\w/g, (ch) => ch.toUpperCase())} tab`,
        binding: [binding],
        run: () => clickDrawerControl((el) => el.getAttribute("role") === "tab" && normalizedControlText(el) === tabLabel),
      });
    }

    if (Array.from(root?.querySelectorAll<HTMLElement>("button") || []).some((el) => isUsableControl(el) && normalizedControlText(el) === "edit")) {
      actions.push({
      id: "drawer.editYaml",
      label: "Edit YAML when available",
      binding: ["e"],
        run: () => clickDrawerControl((el) => normalizedControlText(el) === "edit"),
      });
    }

    if (Array.from(root?.querySelectorAll<HTMLElement>("button") || []).some((el) => isUsableControl(el) && normalizedControlText(el) === "refresh")) {
      actions.push({
      id: "drawer.refresh",
      label: "Refresh current resource when available",
      binding: ["r"],
        run: () => clickDrawerControl((el) => normalizedControlText(el) === "refresh"),
      });
    }

    return registerContextActions(actions);
  }, [actionRevision, clickDrawerControl, onClose, registerContextActions]);

  return (
    <Box
      ref={shellRef}
      data-testid={resourceIcon ? `drawer-${resourceIcon}` : "drawer-resource"}
      tabIndex={-1}
      sx={{
        outline: "none",
        width: drawerWidth,
        p: RESOURCE_DRAWER_PADDING,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
        "& .MuiTabs-root": {
          minHeight: 40,
        },
        "& .MuiTabs-flexContainer": {
          alignItems: "stretch",
        },
        "& .MuiTab-root": {
          minHeight: 40,
          py: 0,
          px: 1.5,
          alignItems: "center",
          flexDirection: "row",
          gap: 1.25,
          lineHeight: 1.2,
          textTransform: "none",
          whiteSpace: "nowrap",
        },
        "& .MuiTab-root.MuiTab-labelIcon": {
          minHeight: 40,
          pt: 0,
          pb: 0,
        },
        "& .MuiTab-root .MuiTab-iconWrapper": {
          mr: 0,
          mb: 0,
        },
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
        {resourceIcon ? <ResourceIcon name={resourceIcon} size={22} sx={{ color: "primary.main" }} /> : null}
        <Typography variant="h6" sx={{ flexGrow: 1, minWidth: 0 }}>
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
