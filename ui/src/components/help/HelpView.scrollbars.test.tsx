// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HelpView from "./HelpView";
import { UserSettingsProvider } from "../../settingsContext";

// Keep this owner test independent of the full bundled Markdown catalogue.
vi.mock("../../help/content", () => {
  const pages = [
    { id: "intro", title: "Introduction", category: "General", body: "# Introduction\nWelcome." },
    { id: "settings", title: "Settings", category: "General", body: "# Settings\nAppearance and workflow." },
  ];
  return {
    helpPages: pages, featuredHelpPages: [pages[0]], helpManifest: { externalLinks: {} },
    helpPagesByCategory: (filtered: typeof pages) => [{ category: "General", pages: filtered }],
  };
});

afterEach(() => { cleanup(); localStorage.clear(); });

it("keeps Help navigation and document scrolling on their existing owners", () => {
  const close = vi.fn();
  render(<UserSettingsProvider><HelpView onClose={close} /></UserSettingsProvider>);
  const shell = screen.getByTestId("help-view");
  const [rail, main] = Array.from(shell.children);
  expect(shell.classList.contains("kview-native-scrollbar")).toBe(false);
  expect(getComputedStyle(shell).overflow).toBe("hidden");
  expect(rail.classList.contains("kview-native-scrollbar")).toBe(true);
  expect(getComputedStyle(rail).overflowY).toBe("auto");
  expect(main.classList.contains("kview-native-scrollbar")).toBe(true);
  expect(getComputedStyle(main).overflow).toBe("auto");
  fireEvent.change(within(rail as HTMLElement).getByRole("textbox", { name: "Search help" }), { target: { value: "settings" } });
  fireEvent.click(within(rail as HTMLElement).getByText("Settings"));
  expect(shell.children[1]).toBe(main);
  expect(within(main as HTMLElement).getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(shell.querySelectorAll(".kview-native-scrollbar")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Close help" }));
  expect(close).toHaveBeenCalledOnce();
});
