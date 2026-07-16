// @vitest-environment jsdom

import React, { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActiveContextProvider } from "../../activeContext";
import { useUserSettings, UserSettingsProvider } from "../../settingsContext";
import { ResourceTagsEditorButton, ResourceTagsRow } from "./ResourceTags";
import type { ResolvedResourceTag } from "../../resourceTags";

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
