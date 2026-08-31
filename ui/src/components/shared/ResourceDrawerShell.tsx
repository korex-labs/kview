import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, Divider, Tab, Tabs, CircularProgress } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import FullscreenOutlinedIcon from "@mui/icons-material/FullscreenOutlined";
import FullscreenExitOutlinedIcon from "@mui/icons-material/FullscreenExitOutlined";
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
  useContextualKeyboardSurfaceActive,
  useKeyboardControls,
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
import {
  actionDefinitionById,
  drawerTabActionAttribute,
  drawerTabProps,
  type DrawerTabActionId,
} from "../../keyboard/actions";
import type { ApiResourceIdentity } from "../../types/api";
import ResourceMapPanel from "./ResourceMapPanel";
import ResourceIdentityDrawer from "./ResourceIdentityDrawer";
import { resolveResourceDrawerIdentity, resourceIdentityKey } from "./resourceMapIdentity";
import { useRightDrawerLayout } from "../layout/RightDrawer";

export type ResourceDrawerIdentity = {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  group?: string;
  version?: string;
  /** Authoritative plural API resource; required for dynamic custom resources. */
  apiResource?: string;
  kind?: string;
  scope?: "namespaced" | "cluster";
  uid?: string;
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


const resourceNotesTabValue = "__kview_resource_notes__";
const resourceMapTabValue = "__kview_resource_map__";

function normalizedControlText(el: HTMLElement): string {
  return (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isUsableControl(el: HTMLElement): boolean {
  return !el.getAttribute("aria-disabled") && !("disabled" in el && Boolean((el as HTMLButtonElement).disabled));
}

function containsElementType(node: React.ReactNode, type: React.ElementType): boolean {
  return React.Children.toArray(node).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (child.type === type) return true;
    return containsElementType((child as React.ReactElement<{ children?: React.ReactNode }>).props.children, type);
  });
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
  const contextualSurfaceActive = useContextualKeyboardSurfaceActive();
  const drawerLayout = useRightDrawerLayout();
  const drawerExpanded = Boolean(drawerLayout?.expanded);
  const [isResizing, setIsResizing] = useState(false);
  const [actionRevision, setActionRevision] = useState(0);
  const [auxiliaryTab, setAuxiliaryTab] = useState<"resource-map" | "notes" | null>(null);
  const [linkedResource, setLinkedResource] = useState<ApiResourceIdentity | null>(null);
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
  const mapIdentity = resolveResourceDrawerIdentity(drawerIdentity);
  const mapIdentityStableKey = resourceIdentityKey(mapIdentity);
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
    setAuxiliaryTab(null);
    setLinkedResource(null);
  }, [mapIdentityStableKey, drawerIdentity?.resource, drawerIdentity?.namespace, drawerIdentity?.name]);

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
    if (!contextualSurfaceActive) return;
    requestKeyboardFocus({
      id: "resource-drawer.shell",
      focus: () => {
        shellRef.current?.focus();
        return document.activeElement === shellRef.current;
      },
    });
  }, [contextualSurfaceActive, requestKeyboardFocus]);


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
      attributeFilter: ["aria-disabled", "disabled", "role", drawerTabActionAttribute],
    });
    bump();
    return () => observer.disconnect();
  }, []);

  const contextualActions = useMemo(() => {
    void actionRevision;
    const root = shellRef.current;
    const actions: ContextualKeyboardAction[] = [];

    const tabs = Array.from(root?.querySelectorAll<HTMLElement>(`[role='tab'][${drawerTabActionAttribute}]`) || [])
      .filter(isUsableControl)
      .map((el) => el.getAttribute(drawerTabActionAttribute) as DrawerTabActionId | null)
      .filter((actionId): actionId is DrawerTabActionId => Boolean(actionId));
    for (const actionId of tabs) {
      const definition = actionDefinitionById.get(actionId);
      if (!definition || !actionId.startsWith("drawer.tab.")) continue;
      actions.push({
        id: actionId,
        label: definition.label,
        run: () => clickDrawerControl((el) => el.getAttribute("role") === "tab" && el.getAttribute(drawerTabActionAttribute) === actionId),
      });
    }

    if (Array.from(root?.querySelectorAll<HTMLElement>("button") || []).some((el) => isUsableControl(el) && normalizedControlText(el) === "edit")) {
      actions.push({
        id: "drawer.editYaml",
        label: "Edit YAML when available",

        run: () => clickDrawerControl((el) => normalizedControlText(el) === "edit"),
      });
    }

    if (Array.from(root?.querySelectorAll<HTMLElement>("button") || []).some((el) => isUsableControl(el) && normalizedControlText(el) === "refresh")) {
      actions.push({
        id: "drawer.refresh",
        label: "Refresh current resource when available",

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

  const hasInjectableNativeTabs = React.isValidElement(children) && children.type === React.Fragment && React.Children.toArray((children as React.ReactElement<{ children?: React.ReactNode }>).props.children)
    .some((child) => React.isValidElement(child) && child.type === Tabs);
  const nativeContentLoading = !hasInjectableNativeTabs && containsElementType(children, CircularProgress);

  const renderChildrenWithNotesTab = useCallback((node: React.ReactNode): React.ReactNode => {
    if ((!showOperatorNotesTab && !mapIdentity) || !React.isValidElement(node)) return node;
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
          value: auxiliaryTab === "notes" ? resourceNotesTabValue : auxiliaryTab === "resource-map" ? resourceMapTabValue : tabsElement.props.value,
          onChange: (event: React.SyntheticEvent, value: unknown) => {
            if (value === resourceNotesTabValue) {
              setAuxiliaryTab("notes");
              return;
            }
            if (value === resourceMapTabValue) {
              setAuxiliaryTab("resource-map");
              return;
            }
            setAuxiliaryTab(null);
            tabsElement.props.onChange?.(event, value);
          },
          children: [
            ...React.Children.toArray(tabsElement.props.children),
            mapIdentity ? <Tab
              key="resource-map"
              {...drawerTabProps("drawer.tab.resourceMap")}
              icon={<AccountTreeOutlinedIcon fontSize="small" />}
              iconPosition="start"
              label="Resource Map"
              aria-label="Resource Map"
              value={resourceMapTabValue}
            /> : null,
            showOperatorNotesTab && notesPanel ? <Tab
              key="resource-notes"
              {...drawerTabProps("drawer.tab.notes")}
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
            /> : null,
          ],
        }));
        if (auxiliaryTab === "resource-map" && mapIdentity) nextChildren.push(
          <ResourceMapPanel key="resource-map-panel" identity={mapIdentity} token={token || ""} onOpenResource={setLinkedResource} />,
        );
        if (auxiliaryTab === "notes" && notesPanel) nextChildren.push(React.cloneElement(notesPanel, { key: "resource-notes-panel" }));
        continue;
      }
      if (!auxiliaryTab || !injected) nextChildren.push(child);
    }

    if (!injected) return node;
    return React.cloneElement(element, undefined, nextChildren);
  }, [auxiliaryTab, drawerIdentity, mapIdentity, notesPanel, showOperatorNotesTab, token]);

  return (
    <Box
      ref={shellRef}
      data-testid={resourceIcon ? `drawer-${resourceIcon}` : "drawer-resource"}
      tabIndex={-1}
      sx={{
        outline: "none",
        width: drawerExpanded ? "100%" : drawerWidth,
        boxSizing: drawerExpanded ? "border-box" : undefined,
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
          display: drawerExpanded ? "none" : "block",
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
        {drawerLayout ? (
          <AppIconButton
            tooltip={drawerExpanded ? "Restore drawer size" : "Expand drawer to full screen"}
            label={drawerExpanded ? "Restore drawer size" : "Expand drawer to full screen"}
            onClick={drawerLayout.toggleExpanded}
            sx={{ flexShrink: 0, mt: 0.25 }}
          >
            {drawerExpanded ? <FullscreenExitOutlinedIcon fontSize="small" /> : <FullscreenOutlinedIcon fontSize="small" />}
          </AppIconButton>
        ) : null}
        <AppIconButton tooltip="Close drawer" label="Close drawer" onClick={onClose} sx={{ flexShrink: 0, mt: 0.25 }}>
          <CloseIcon fontSize="small" />
        </AppIconButton>
      </Box>

      <Divider sx={{ my: RESOURCE_DRAWER_HEADER_DIVIDER_MY }} />

      {hasInjectableNativeTabs ? renderChildrenWithNotesTab(children) : (
        <>
          {!nativeContentLoading && (mapIdentity || (showOperatorNotesTab && notesPanel)) ? (
            <Tabs value={auxiliaryTab === "resource-map" ? resourceMapTabValue : auxiliaryTab === "notes" ? resourceNotesTabValue : false} onChange={(_, value) => setAuxiliaryTab(value === resourceMapTabValue ? "resource-map" : value === resourceNotesTabValue ? "notes" : null)}>
              {mapIdentity ? <Tab {...drawerTabProps("drawer.tab.resourceMap")} icon={<AccountTreeOutlinedIcon fontSize="small" />} iconPosition="start" label="Resource Map" aria-label="Resource Map" value={resourceMapTabValue} /> : null}
              {showOperatorNotesTab && notesPanel ? <Tab {...drawerTabProps("drawer.tab.notes")} icon={<DetailTabIcon label="Notes" />} iconPosition="start" label="Notes" aria-label="Notes" value={resourceNotesTabValue} /> : null}
            </Tabs>
          ) : null}
          {!nativeContentLoading && auxiliaryTab === "resource-map" && mapIdentity ? <ResourceMapPanel identity={mapIdentity} token={token || ""} onOpenResource={setLinkedResource} /> : null}
          {!nativeContentLoading && auxiliaryTab === "notes" && notesPanel ? notesPanel : null}
          {nativeContentLoading || !auxiliaryTab ? children : null}
        </>
      )}
      <ResourceIdentityDrawer token={token || ""} identity={linkedResource} open={Boolean(linkedResource)} onClose={() => setLinkedResource(null)} />
    </Box>
  );
}
