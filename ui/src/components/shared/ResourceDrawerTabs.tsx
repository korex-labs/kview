import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Box, ListItemIcon, Menu, MenuItem, Tabs, TabScrollButton, type TabsProps, type TabScrollButtonProps } from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { AppButton } from "./AppActions";

type Destination = { element: HTMLElement; label: string; icon?: React.ReactNode; selected: boolean; disabled: boolean };

const DrawerScrollButton = React.forwardRef<HTMLButtonElement, TabScrollButtonProps>(function DrawerScrollButton(props, ref) {
  return <TabScrollButton {...props} ref={ref} role="button" tabIndex={props.disabled ? -1 : 0} aria-label={`Scroll sections ${props.direction}`} />;
});

/**
 * Adapter for existing MUI tab definitions. Tabs stay mounted, in source order,
 * so drawer keyboard action discovery and each tab's original click path survive
 * overflow. More is a second navigation affordance, not a second tab registry.
 */
export default function ResourceDrawerTabs(props: TabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [hiddenSelection, setHiddenSelection] = useState("");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);

  useEffect(() => {
    if (!anchor && restoreFocusRef.current) {
      restoreFocusRef.current.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    }
  }, [anchor]);

  const measure = useCallback((reveal = false) => {
    const root = rootRef.current;
    const scroller = root?.querySelector<HTMLElement>(".MuiTabs-scroller");
    const list = root?.querySelector<HTMLElement>("[role='tablist']");
    if (!root || !scroller || !list || root.clientWidth === 0) return;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>("[role='tab']"));
    const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    // Compare natural tab width to the whole container, not the already-shrunken
    // scroller: otherwise the More button could keep itself visible after resize.
    const naturalWidth = tabs.reduce((width, tab) => width + tab.getBoundingClientRect().width, 0);
    const hasOverflow = naturalWidth > root.clientWidth + 1;
    setOverflow(hasOverflow);
    if (!hasOverflow) setAnchor(null);
    const viewport = scroller.getBoundingClientRect();
    if (selected && reveal) {
      const rect = selected.getBoundingClientRect();
      if (rect.left < viewport.left) scroller.scrollLeft += rect.left - viewport.left;
      else if (rect.right > viewport.right) scroller.scrollLeft += rect.right - viewport.right;
    }
    const rect = selected?.getBoundingClientRect();
    const hidden = rect && (rect.left < viewport.left - 1 || rect.right > viewport.right + 1);
    setHiddenSelection(hidden ? (selected?.getAttribute("aria-label") || selected?.textContent || "").trim() : "");
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = root?.querySelector<HTMLElement>(".MuiTabs-scroller");
    const list = root?.querySelector<HTMLElement>("[role='tablist']");
    const onScroll = () => measure();
    const onResize = () => measure(true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      // A wider selected-label button also resizes the scroller. Do not mistake
      // that for drawer resizing and snap manual scrolling back to selection.
      measure(entries.some((entry) => entry.target === root));
    });
    if (root) observer?.observe(root);
    if (scroller) observer?.observe(scroller);
    if (list) observer?.observe(list);
    scroller?.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    measure(true);
    return () => {
      observer?.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [measure]);

  useLayoutEffect(() => { measure(true); }, [measure, props.value]);
  useLayoutEffect(() => { measure(); }, [measure, props.children, overflow]);

  return (
    <Box ref={rootRef} data-resource-drawer-tabs sx={{ display: "flex", alignItems: "center", minWidth: 0, maxWidth: "100%", flexShrink: 0 }}>
      <Tabs
        {...props}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        slots={{ ...props.slots, scrollButtons: DrawerScrollButton }}
        sx={[{ minWidth: 0, flex: 1 }, ...(Array.isArray(props.sx) ? props.sx : [props.sx])]}
      />
      {overflow && (
        <AppButton
          variant="text"
          aria-label={hiddenSelection ? `More sections — selected: ${hiddenSelection}` : "More sections"}
          aria-haspopup="menu"
          aria-controls={anchor ? menuId : undefined}
          aria-expanded={Boolean(anchor)}
          endIcon={<ArrowDropDownIcon />}
          sx={{ flexShrink: 0, maxWidth: "45%", minWidth: 64, textTransform: "none" }}
          onClick={(event) => {
            const tabs = rootRef.current?.querySelectorAll<HTMLElement>("[role='tablist'] [role='tab']");
            const definitions = React.Children.toArray(props.children).filter(React.isValidElement) as React.ReactElement<{ icon?: React.ReactNode }>[];
            setDestinations(Array.from(tabs || []).map((element, index) => ({
              icon: definitions[index]?.props.icon,
              element,
              label: (element.getAttribute("aria-label") || element.textContent || "").trim(),
              selected: element.getAttribute("aria-selected") === "true",
              disabled: element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled"),
            })));
            setAnchor(event.currentTarget);
          }}
        >
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hiddenSelection ? `More: ${hiddenSelection}` : "More"}
          </Box>
        </AppButton>
      )}
      <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor) && overflow} onClose={() => { restoreFocusRef.current = anchor; setAnchor(null); }} disableRestoreFocus>
        {destinations.map(({ element, label, icon, selected, disabled }, index) => (
          <MenuItem key={index} selected={selected} disabled={disabled} aria-current={selected ? "page" : undefined} onClick={() => {
            restoreFocusRef.current = element;
            setAnchor(null);
            element.click();
            measure(true);
          }}>{icon ? <ListItemIcon sx={{ minWidth: 28 }} aria-hidden="true">{icon}</ListItemIcon> : null}{label}</MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
