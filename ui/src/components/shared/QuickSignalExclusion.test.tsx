// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveContextProvider } from "../../activeContext";
import { apiPostWithContext } from "../../api";
import { UserSettingsProvider, useUserSettings } from "../../settingsContext";
import { QuickSignalExclusionButton, QuickSignalExclusionProvider } from "./QuickSignalExclusion";

vi.mock("../../api", () => ({
  apiPostWithContext: vi.fn(async () => ({ candidateCount: 1, matchedCount: 1, items: [] })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

const testSignal = {
  signalType: "pod_restarts",
  kind: "Pod",
  namespace: "apps.prod",
  name: "api[0]",
  severity: "high" as const,
  score: 1,
  reason: "Container restarts",
};

function SettingsProbe() {
  const { settings } = useUserSettings();
  const rules = settings.dataplane.contextOverrides["prod-cluster"]?.signals?.overrides.pod_restarts.exclusions?.rules || [];
  return <output data-testid="saved-rule-count">{rules.length}</output>;
}

function renderQuickExclusion() {
  render(
    <UserSettingsProvider>
      <ActiveContextProvider value="prod-cluster">
        <QuickSignalExclusionProvider token="token">
          <QuickSignalExclusionButton signal={testSignal} />
          <SettingsProbe />
        </QuickSignalExclusionProvider>
      </ActiveContextProvider>
    </UserSettingsProvider>,
  );
}

describe("QuickSignalExclusion", () => {
  it("opens the shared editor with an exact current-context rule", () => {
    renderQuickExclusion();

    fireEvent.click(screen.getByRole("button", { name: "Exclude this signal" }));
    expect(screen.getByText("Pod Restarts exclusions")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Apply to" }).textContent).toContain("Current context");
    expect(screen.getByDisplayValue("^apps\\.prod$")).toBeTruthy();
    expect(screen.getByDisplayValue("^api\\[0\\]$")).toBeTruthy();
    expect(screen.getByDisplayValue("Exclude Pod apps.prod/api[0]")).toBeTruthy();
  });

  it("validates and saves the generated rule into the current context", async () => {
    renderQuickExclusion();
    fireEvent.click(screen.getByRole("button", { name: "Exclude this signal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save exclusions" }));

    await waitFor(() => expect(screen.getByTestId("saved-rule-count").textContent).toBe("1"));
    expect(vi.mocked(apiPostWithContext)).toHaveBeenCalledWith(
      "/api/dataplane/signals/exclusions/preview",
      "token",
      "prod-cluster",
      expect.objectContaining({ signalType: "pod_restarts" }),
    );
    expect(screen.queryByText("Pod Restarts exclusions")).toBeNull();
  });
});
