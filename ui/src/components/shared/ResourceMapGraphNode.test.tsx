// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTheme, getContrastRatio, ThemeProvider } from "@mui/material/styles";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResourceMapNode } from "../../types/api";
import ResourceMapGraphNode from "./ResourceMapGraphNode";
import { resourceMapColors } from "./resourceMapColors";
import type { ResourceMapFlowNode } from "./resourceMapGraphModel";
import type { ResourceMapPresentationNode } from "./resourceOwnershipPresentation";

const node: ResourceMapNode = {
  id: "sample", identity: { group: "apps", version: "v1", resource: "deployments", kind: "Deployment", scope: "namespaced", namespace: "demo", name: "sample" },
  current: false, direction: "child", depth: 1, availability: "present", navigable: true,
};
function props(resourceNode: ResourceMapPresentationNode, onOpenResource = vi.fn(), onToggleGroup = vi.fn()): NodeProps<ResourceMapFlowNode> {
  return {
    id: resourceNode.id, type: "resourceMap", dragging: false, zIndex: 0, selectable: false, deletable: false, selected: false, draggable: false,
    isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0,
    data: { resourceNode, uiNavigable: true, onOpenResource, onToggleGroup, incoming: [], outgoing: [], incomingHandlePositions: {}, outgoingHandlePositions: {}, incomingHandleOffsets: {}, outgoingHandleOffsets: {} },
  };
}
// jsdom does not implement pointer :hover. Inspect the emitted hover rule,
// separately from computed normal/current styles and real keyboard-focus state.
function hoverBackground(element: Element): string | undefined {
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.endsWith(":hover") && element.matches(rule.selectorText.slice(0, -6))) {
        const color = rule.style.getPropertyValue("background-color");
        if (color) return color;
      }
    }
  }
}
afterEach(cleanup);

describe.each(["light", "dark"] as const)("ResourceMapGraphNode %s", (mode) => {
  const theme = createTheme({ palette: { mode } });
  const wrap = (resourceNode: ResourceMapPresentationNode, open = vi.fn(), toggle = vi.fn()) => (
    <ThemeProvider theme={theme}><ReactFlowProvider><ResourceMapGraphNode {...props(resourceNode, open, toggle)} /></ReactFlowProvider></ThemeProvider>
  );

  it("renders the palette in normal/current/hover/focus states without changing identity or status", () => {
    const colors = resourceMapColors(theme, "deployments");
    const open = vi.fn();
    const view = render(wrap(node, open));
    const card = screen.getByRole("button", { name: "Deployment: sample" });
    expect(card.tabIndex).toBe(0);
    expect(getComputedStyle(card).backgroundColor).toBe(colors.fill);
    expect(getComputedStyle(card).color).toBe(colors.text);
    expect(getComputedStyle(card).borderColor).toBe(colors.boundary);
    expect(getComputedStyle(card.querySelector("svg")!).color).toBe(colors.icon);
    expect(getComputedStyle(screen.getByText("demo")).color).toBe(colors.metadata);
    expect(hoverBackground(card)).toBe(colors.hover);
    expect(screen.getByText("present").closest(".MuiChip-root")?.className).toContain("MuiChip-colorSuccess");
    fireEvent.click(card, { detail: 0 });
    expect(open).toHaveBeenCalledExactlyOnceWith(node.identity);
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => card.focus());
    expect(document.activeElement).toBe(card);
    expect(card.classList.contains("Mui-focusVisible")).toBe(true);
    expect(getComputedStyle(card).outlineColor).toBe(colors.accent);
    expect(getComputedStyle(card).outlineOffset).toBe("3px");
    act(() => card.blur());
    view.rerender(wrap({ ...node, current: true, direction: "current" }, open));
    expect(getComputedStyle(card).backgroundColor).toBe(colors.current);
    expect(getComputedStyle(card).outline).toContain(colors.accent);
    expect(getComputedStyle(card).borderColor).toBe(colors.boundary);
    expect(hoverBackground(card)).toBe(colors.hover);
  });

  it("keeps unavailable custom-resource text opaque with a dashed boundary and warning badge", () => {
    render(wrap({ ...node, availability: "missing", identity: { ...node.identity, resource: "widgets", kind: "Widget" } }));
    const card = screen.getByRole("button", { name: "Widget: sample" });
    const colors = resourceMapColors(theme, "customresources");
    const style = getComputedStyle(card);
    expect(style.backgroundColor).toBe(colors.fill);
    expect(style.opacity || "1").toBe("1");
    expect(style.borderStyle).toBe("dashed");
    expect(getContrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    expect(screen.getByText("missing").closest(".MuiChip-root")?.className).toContain("MuiChip-colorWarning");
  });

  it("uses the Pod palette for ownership groups without changing expansion", () => {
    const toggle = vi.fn();
    const group: ResourceMapPresentationNode = {
      presentation: "podGroup", id: "group", depth: 1, owner: node.identity, expanded: false, visibleMembers: 0,
      group: { id: "group", ownerId: "sample", observedCount: 2, countComplete: true, members: [], membersTruncated: false, states: { Running: 2 } },
    };
    render(wrap(group, vi.fn(), toggle));
    const card = screen.getByRole("button", { name: "Expand Pods owned by Deployment sample" });
    expect(getComputedStyle(card).backgroundColor).toBe(resourceMapColors(theme, "pods").fill);
    expect(card.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(card);
    expect(toggle).toHaveBeenCalledExactlyOnceWith("group");
  });
});
