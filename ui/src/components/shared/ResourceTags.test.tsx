// @vitest-environment jsdom

import React, { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActiveContextProvider } from "../../activeContext";
import { useUserSettings, UserSettingsProvider } from "../../settingsContext";
import { ResourceTagsEditorButton, ResourceTagsRow } from "./ResourceTags";
import type { ResolvedResourceTag } from "../../resourceTags";
import { readFileSync } from "node:fs";
const themeCss = readFileSync("src/styles/theme.css", "utf8");

function tag(id: string, name: string, inherited = false): ResolvedResourceTag {
  return { id, name, color: "#1976d2", inherited, source: inherited ? "inherited" : "direct" };
}

describe("ResourceTagsRow", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("shows an overflow chip when not all tags are visible", () => {
    render(<ResourceTagsRow tags={[tag("a", "Alpha"), tag("b", "Beta"), tag("c", "Gamma", true)]} maxVisible={2} />);

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  it.each(["light", "dark"])("styles only the long portaled menu owner in %s and preserves keyboard/assignment/focus", async (mode) => {
    function Harness() {
      const { setSettings } = useUserSettings();
      useEffect(() => {
        setSettings((prev) => ({ ...prev, resourceTags: {
          ...prev.resourceTags, enabled: true,
          definitions: Array.from({ length: 40 }, (_, i) => ({ id: `tag-${i}`, name: `Tag ${i}`, color: "#1976d2" })),
        } }));
      }, [setSettings]);
      return <ResourceTagsEditorButton target={{ context: "synthetic", resource: "pods", namespace: "test", name: "pod-a" }} />;
    }
    document.documentElement.setAttribute("data-theme", mode);
    try {
      const view = render(<><style>{themeCss}</style><UserSettingsProvider><Harness /></UserSettingsProvider></>);
      const trigger = screen.getByRole("button", { name: "Edit resource tags" });
      act(() => trigger.focus());
      fireEvent.click(trigger);
      const menu = screen.getByRole("menu");
      const paper = menu.closest(".MuiPaper-root")!;
      expect(view.container.contains(paper)).toBe(false);
      expect(paper.classList.contains("kview-native-scrollbar")).toBe(true);
      expect(getComputedStyle(paper).overflowY).toBe("auto");
      expect(getComputedStyle(paper).scrollbarWidth).toBe("auto");
      // jsdom 30 miscomputes scrollbar-color (even `auto`); assert the actual
      // mounted selector boundary, paired with CSSOM declarations in nativeScrollbars.
      const resetSelector = ".kview-native-scrollbar :not(.kview-native-scrollbar)";
      expect(menu.matches(resetSelector)).toBe(true);
      expect(paper.matches(resetSelector)).toBe(false);
      const first = within(menu).getByRole("menuitem", { name: "Tag 0" });
      const last = within(menu).getByRole("menuitem", { name: "Tag 39" });
      act(() => first.focus());
      fireEvent.keyDown(first, { key: "ArrowDown" });
      expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Tag 1" }));
      // The creation form follows tags, so End need not mean the final tag.
      act(() => last.focus());
      fireEvent.click(last);
      expect((within(last).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
      expect(menu.closest(".MuiPaper-root")).toBe(paper);
      fireEvent.keyDown(last, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(document.activeElement).toBe(trigger);
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("creates and assigns a tag from the drawer tag menu", async () => {
    function Harness() {
      const { settings, setSettings } = useUserSettings();
      useEffect(() => {
        setSettings((prev) => ({
          ...prev,
          resourceTags: {
            ...prev.resourceTags,
            enabled: true,
          },
        }));
      }, [setSettings]);

      const incident = settings.resourceTags.definitions.find((definition) => definition.name === "Incident");

      return (
        <>
          <ResourceTagsEditorButton
            target={{ context: "kind-test", resource: "pods", namespace: "default", name: "pod-a" }}
          />
          <span data-testid="incident-color">{incident?.color || ""}</span>
        </>
      );
    }

    render(
      <ActiveContextProvider value="kind-test">
        <UserSettingsProvider>
          <Harness />
        </UserSettingsProvider>
      </ActiveContextProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit resource tags" }));
    fireEvent.change(screen.getByPlaceholderText("New tag"), { target: { value: "Incident" } });
    fireEvent.click(screen.getByRole("button", { name: "Use tag color #e53935" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => expect(screen.getByText("Incident")).toBeTruthy());
    expect(screen.getByTestId("incident-color").textContent).toBe("#e53935");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  }, 20000);
});
