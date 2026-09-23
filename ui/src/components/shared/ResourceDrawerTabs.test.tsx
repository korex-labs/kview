// @vitest-environment jsdom
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tab } from "@mui/material";
import ResourceDrawerTabs from "./ResourceDrawerTabs";

let resize: (entries: { target: Element }[]) => void;
function geometry(container: HTMLElement, initialWidth: number) {
  let width = initialWidth;
  const root = container.querySelector<HTMLElement>("[data-resource-drawer-tabs]")!;
  const scroller = root.querySelector<HTMLElement>(".MuiTabs-scroller")!;
  Object.defineProperty(root, "clientWidth", { configurable: true, get: () => width });
  vi.spyOn(scroller, "getBoundingClientRect").mockImplementation(() => ({ left: 0, right: width, width, height: 40, top: 0, bottom: 40, x: 0, y: 0, toJSON: () => ({}) }));
  root.querySelectorAll<HTMLElement>("[role='tab']").forEach((tab, index) => {
    vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() => {
      const left = index * 120 - scroller.scrollLeft;
      return { left, right: left + 120, width: 120, height: 40, top: 0, bottom: 40, x: left, y: 0, toJSON: () => ({}) };
    });
  });
  act(() => resize([{ target: root }]));
  return { scroller, setWidth: (value: number) => { width = value; act(() => resize([{ target: root }])); } };
}

function Harness({ onClick = () => {} }: { onClick?: () => void }) {
  const [value, setValue] = useState("overview");
  return <ResourceDrawerTabs value={value} onChange={(_, next: string) => setValue(next)} aria-label="Resource sections">
    <Tab value="overview" label="Overview" data-keyboard-action-id="drawer.tab.overview" />
    <Tab value="yaml" icon={<svg data-testid="yaml-icon" />} label="YAML" data-keyboard-action-id="drawer.tab.yaml" onClick={onClick} />
    <Tab value="notes" label={<span>Notes <small>Investigating</small></span>} aria-label="Notes" data-keyboard-action-id="drawer.tab.notes" />
    <Tab value="disabled" label="Unavailable" disabled />
  </ResourceDrawerTabs>;
}

function mockResizeObserver() {
  vi.stubGlobal("ResizeObserver", class {
    callback: typeof resize;
    constructor(callback: typeof resize) { this.callback = callback; }
    observe(element: Element) { if (element.hasAttribute("data-resource-drawer-tabs")) resize = this.callback; }
    unobserve() {}
    disconnect() {}
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ResourceDrawerTabs", () => {
  it("keeps stable semantic tabs mounted and directly selects from the measured overflow menu", () => {
    mockResizeObserver();
    const onClick = vi.fn();
    const { container } = render(<Harness onClick={onClick} />);
    geometry(container, 160);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "YAML", "Notes Investigating", "Unavailable"]);
    expect(tabs[1].getAttribute("data-keyboard-action-id")).toBe("drawer.tab.yaml");
    expect(container.querySelector(".MuiTabs-scrollableX")).toBeTruthy();
    expect(container.querySelector(".MuiTabs-scrollButtonsHideMobile")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More sections" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Overview", "YAML", "Notes", "Unavailable"]);
    expect(screen.getByRole("menuitem", { name: "Unavailable" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "YAML" }).querySelector('[data-testid="yaml-icon"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "YAML" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(4);
  });

  it("names a selected off-screen destination, reveals on resize, and removes More when the container grows", () => {
    mockResizeObserver();
    const { container } = render(<Harness />);
    const layout = geometry(container, 160);
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(layout.scroller.scrollLeft).toBe(200);
    layout.scroller.scrollLeft = 0;
    fireEvent.scroll(layout.scroller);
    expect(screen.getByRole("button", { name: "More sections — selected: Notes" }).textContent).toContain("More: Notes");
    layout.setWidth(180);
    expect(layout.scroller.scrollLeft).toBe(180);
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    layout.setWidth(600);
    expect(screen.queryByRole("button", { name: /More sections/ })).toBeNull();
    layout.setWidth(140);
    expect(screen.getByRole("button", { name: "More sections" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
  });

  it("retains roving tab focus and menu keyboard navigation without changing destination order", () => {
    mockResizeObserver();
    const { container } = render(<Harness />);
    geometry(container, 160);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "YAML" }));
    fireEvent.click(screen.getByRole("button", { name: "More sections" }));
    const first = screen.getByRole("menuitem", { name: "Overview" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "YAML" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More sections" }));
  });
});
