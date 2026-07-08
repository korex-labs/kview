import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, Divider, Tab, Tabs } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  RESOURCE_DRAWER_WIDTH,
  RESOURCE_DRAWER_MIN_WIDTH,
  RESOURCE_DRAWER_MAX_WIDTH,
  RESOURCE_DRAWER_PADDING,
  RESOURCE_DRAWER_HEADER_DIVIDER_MY,
} from "../../constants/drawerTokens";
import { useUserSettings } from "../../settingsContext";
import {
  useContextualKeyboardActions,
  useKeyboardControls,
  useKeyboardScope,
  type ContextualKeyboardAction,
} from "../../keyboard/KeyboardProvider";
import ResourceIcon from "../icons/resources/ResourceIcon";
import type { ResourceIconName } from "../icons/resources/types";
import { AppIconButton } from "./AppActions";
import ResourceDynamicLinks from "./ResourceDynamicLinks";
import type { ListResourceKey } from "../../utils/k8sResources";
import { ResourceDrawerTags } from "./ResourceTags";
import { ResourceDrawerMacros } from "./ResourceMacros";
import { ResourceMemoryPanel, ResourceMemoryTabLabel } from "./ResourceMemory";
import DetailTabIcon from "./DetailTabIcon";

type ResourceDrawerIdentity = {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type ResourceDrawerShellProps = {
  /** Header title (e.g. "Pod: my-pod" or a fragment with chips). */
  title: React.ReactNode;
  resourceIcon?: ResourceIconName;
  headerMeta?: React.ReactNode;
  resourceIdentity?: ResourceDrawerIdentity;
  dynamicLinks?: ResourceDrawerIdentity;
  headerActions?: React.ReactNode;
  token?: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Content width in px. Defaults to RESOURCE_DRAWER_WIDTH (820).
   * Use RESOURCE_DRAWER_WIDTH_NARROW (620) for simpler/narrow drawers.
   */
  contentWidth?: number;
};

const tabShortcutBindings: Record<string, string> = {
  notes: "n",
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

const resourceNotesTabValue = "__kview_resource_notes__";

function normalizedControlText(el: HTMLElement): string {
  return (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
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
  headerMeta,
  resourceIdentity,
  dynamicLinks,
  headerActions,
  token,
  onClose,
  children,
  contentWidth = RESOURCE_DRAWER_WIDTH,
}: ResourceDrawerShellProps) {
  const { settings, setSettings } = useUserSettings();
  const { requestKeyboardFocus } = useKeyboardControls();
  const [isResizing, setIsResizing] = useState(false);
  const [actionRevision, setActionRevision] = useState(0);
  const [showResourceNotes, setShowResourceNotes] = useState(false);
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
  const drawerIdentity = resourceIdentity || dynamicLinks || null;
  const showAutoHeaderTags = Boolean(drawerIdentity && !headerMeta && settings.resourceTags.enabled);
  const showHeaderMetaRow = Boolean(headerMeta || showAutoHeaderTags || dynamicLinks);
  const showAutoHeaderActions = Boolean(
    drawerIdentity &&
    !headerActions &&
    (settings.resourceMacros.enabled || settings.resourceTags.enabled),
  );
  const showHeaderActions = Boolean(headerActions || showAutoHeaderActions);
  const showOperatorNotesTab = Boolean(drawerIdentity?.name);

  useEffect(() => {
    if (isResizing) return;
    setDrawerWidth(clampWidth(settings.appearance.resourceDrawerWidthPx || contentWidth));
  }, [clampWidth, contentWidth, isResizing, settings.appearance.resourceDrawerWidthPx]);

  useEffect(() => {
    setShowResourceNotes(false);
  }, [drawerIdentity?.resource, drawerIdentity?.namespace, drawerIdentity?.name]);

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
    requestKeyboardFocus({
      id: "resource-drawer.shell",
      focus: () => {
        shellRef.current?.focus();
        return document.activeElement === shellRef.current;
      },
    });
  }, [requestKeyboardFocus]);

  useKeyboardScope(useMemo(() => ({
    id: "resource-drawer",
    label: "Resource drawer",
    kind: "drawer",
    suppressGlobalShortcuts: true,
  }), []));

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

  const contextualActions = useMemo(() => {
    void actionRevision;
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

    return actions;
  }, [actionRevision, clickDrawerControl]);

  useContextualKeyboardActions(contextualActions);

  const notesPanel = useMemo(() => (
    showOperatorNotesTab && drawerIdentity?.name ? (
      <ResourceMemoryPanel
        resource={drawerIdentity.resource}
        namespace={drawerIdentity.namespace}
        name={drawerIdentity.name}
        token={token}
      />
    ) : null
  ), [drawerIdentity?.name, drawerIdentity?.namespace, drawerIdentity?.resource, showOperatorNotesTab, token]);

  const renderChildrenWithNotesTab = useCallback((node: React.ReactNode): React.ReactNode => {
    if (!showOperatorNotesTab || !notesPanel || !React.isValidElement(node)) return node;
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    if (element.type !== React.Fragment) return node;

    let injected = false;
    const nextChildren: React.ReactNode[] = [];
    for (const child of React.Children.toArray(element.props.children)) {
      if (!injected && React.isValidElement(child) && child.type === Tabs) {
        injected = true;
        const tabsElement = child as React.ReactElement<{
          children?: React.ReactNode;
          onChange?: (event: React.SyntheticEvent, value: unknown) => void;
          value?: unknown;
        }>;
        const existingTabLabels = React.Children.toArray(tabsElement.props.children)
          .filter(React.isValidElement)
          .map((tabChild) => String((tabChild as React.ReactElement<{ label?: React.ReactNode }>).props.label || "").trim().toLowerCase());
        if (existingTabLabels.includes("notes")) {
          nextChildren.push(child);
          continue;
        }
        nextChildren.push(React.cloneElement(tabsElement, {
          value: showResourceNotes ? resourceNotesTabValue : tabsElement.props.value,
          onChange: (event: React.SyntheticEvent, value: unknown) => {
            if (value === resourceNotesTabValue) {
              setShowResourceNotes(true);
              return;
            }
            setShowResourceNotes(false);
            tabsElement.props.onChange?.(event, value);
          },
          children: [
            ...React.Children.toArray(tabsElement.props.children),
            <Tab
              key="resource-notes"
              icon={<DetailTabIcon label="Notes" />}
              iconPosition="start"
              label={(
                <ResourceMemoryTabLabel
                  resource={drawerIdentity!.resource}
                  namespace={drawerIdentity!.namespace}
                  name={drawerIdentity!.name}
                />
              )}
              aria-label="Notes"
              value={resourceNotesTabValue}
            />,
          ],
        }));
        if (showResourceNotes) nextChildren.push(React.cloneElement(notesPanel, { key: "resource-notes-panel" }));
        continue;
      }
      if (!showResourceNotes || !injected) nextChildren.push(child);
    }

    if (!injected) return node;
    return React.cloneElement(element, undefined, nextChildren);
  }, [drawerIdentity, notesPanel, showOperatorNotesTab, showResourceNotes]);

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
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        {resourceIcon ? <ResourceIcon name={resourceIcon} size={22} sx={{ color: "primary.main", mt: 0.35 }} /> : null}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {title}
          </Typography>
          {showHeaderMetaRow ? (
            <Box sx={{ mt: 0.75, minWidth: 0, display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
              {headerMeta ? <Box sx={{ display: "contents" }}>{headerMeta}</Box> : null}
              {showAutoHeaderTags && drawerIdentity ? (
                <ResourceDrawerTags
                  resource={drawerIdentity.resource}
                  namespace={drawerIdentity.namespace}
                  name={drawerIdentity.name}
                  labels={drawerIdentity.labels}
                  annotations={drawerIdentity.annotations}
                />
              ) : null}
              {dynamicLinks ? <ResourceDynamicLinks {...dynamicLinks} /> : null}
            </Box>
          ) : null}
        </Box>
        {showHeaderActions ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0, mt: 0.25 }}>
            {headerActions}
            {showAutoHeaderActions && drawerIdentity ? (
              <>
                <ResourceDrawerMacros
                  resource={drawerIdentity.resource}
                  namespace={drawerIdentity.namespace}
                  name={drawerIdentity.name}
                  nodeName={drawerIdentity.nodeName}
                  labels={drawerIdentity.labels}
                  annotations={drawerIdentity.annotations}
                />
                <ResourceDrawerTags
                  resource={drawerIdentity.resource}
                  namespace={drawerIdentity.namespace}
                  name={drawerIdentity.name}
                  labels={drawerIdentity.labels}
                  annotations={drawerIdentity.annotations}
                  mode="edit"
                />
              </>
            ) : null}
          </Box>
        ) : null}
        <AppIconButton tooltip="Close drawer" label="Close drawer" onClick={onClose} sx={{ flexShrink: 0, mt: 0.25 }}>
          <CloseIcon fontSize="small" />
        </AppIconButton>
      </Box>

      <Divider sx={{ my: RESOURCE_DRAWER_HEADER_DIVIDER_MY }} />

      {renderChildrenWithNotesTab(children)}
    </Box>
  );
}
