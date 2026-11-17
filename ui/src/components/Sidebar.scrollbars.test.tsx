// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import Sidebar from "./Sidebar";

let style: HTMLStyleElement;
afterEach(() => { cleanup(); style?.remove(); });

it("opts in only the navigation scroll owner and isolates nested independent scrollers", () => {
  const onSelectSection = vi.fn();
  const { container } = render(<Sidebar contexts={[]} activeContext="" onSelectContext={vi.fn()}
    namespaces={[]} namespace="" onSelectNamespace={vi.fn()} nsLimited={false}
    favourites={[]} onToggleFavourite={vi.fn()} onToggleGroup={vi.fn()}
    section="pods" onSelectSection={onSelectSection} />);
  const owners = container.querySelectorAll(".kview-native-scrollbar");
  expect(owners).toHaveLength(1);
  const owner = owners[0];
  expect(getComputedStyle(owner).overflowY).toBe("auto");
  expect(owner.contains(screen.getByTestId("nav-pods"))).toBe(true);
  expect(owner.contains(screen.getByLabelText("Context"))).toBe(false);
  expect(owner.closest(".MuiDrawer-paper")?.classList.contains("kview-native-scrollbar")).toBe(false);
  fireEvent.click(screen.getByTestId("nav-services"));
  expect(onSelectSection).toHaveBeenCalledWith("services");

  style = document.createElement("style");
  style.textContent = readFileSync("src/styles/theme.css", "utf8");
  document.head.append(style);
  const rules = Array.from(style.sheet!.cssRules) as CSSStyleRule[];
  const optIn = rules.find(rule => rule.selectorText === ".kview-native-scrollbar")!;
  const reset = rules.find(rule => rule.selectorText === ".kview-native-scrollbar :not(.kview-native-scrollbar)")!;
  const nested = document.createElement("div");
  nested.innerHTML = '<pre></pre><div class="xterm-viewport"></div><div class="react-flow"></div><div class="kview-native-scrollbar"><textarea></textarea></div>';
  owner.append(nested);
  // CSSOM + selector matching: jsdom miscomputes scrollbar-color:auto.
  expect(reset.style.getPropertyValue("scrollbar-color")).toBe("auto");
  for (const child of nested.querySelectorAll("pre, .xterm-viewport, .react-flow, textarea")) {
    expect(child.matches(reset.selectorText)).toBe(true);
    expect(child.matches(optIn.selectorText)).toBe(false);
  }
  const explicit = nested.querySelector(".kview-native-scrollbar")!;
  expect(explicit.matches(optIn.selectorText)).toBe(true);
  expect(explicit.matches(reset.selectorText)).toBe(false);
});
