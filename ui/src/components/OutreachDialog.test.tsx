// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OutreachDialog from "./OutreachDialog";
import { UserSettingsProvider, useUserSettings } from "../settingsContext";
import { defaultUserSettings, saveUserSettings } from "../settings";
import { setStatisticsConsent, statisticsConsent, useInstallationStatistics } from "../installationStatistics";

const key = "kview:outreachInvitationDecision:v1";
function Harness({ ready = true }: { ready?: boolean }) {
  const { settings } = useUserSettings();
  useInstallationStatistics(ready ? "test-token" : "");
  return <><output data-testid="release-enabled">{String(settings.appearance.releaseChecksEnabled)}</output><OutreachDialog ready={ready} /></>;
}
function mount(ready = true) { return render(<UserSettingsProvider><Harness ready={ready} /></UserSettingsProvider>); }
beforeEach(() => {
  localStorage.clear();
  setStatisticsConsent(false);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("one-time outreach invitation", () => {
  it.each(["No thanks", "close", "Escape"])("%s discards draft consent permanently on remount", (action) => {
    const view = mount();
    const switches = screen.getAllByRole("switch") as HTMLInputElement[];
    expect(switches.map((input) => input.checked)).toEqual([false, false]);
    fireEvent.click(switches[0]);
    fireEvent.click(switches[1]);
    expect(fetch).not.toHaveBeenCalled();
    if (action === "Escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: action === "close" ? "Close optional updates and statistics" : action }));
    expect(localStorage.getItem(key)).toBe("done");
    expect(statisticsConsent()).toBe(false);
    expect(screen.getByTestId("release-enabled").textContent).toBe("false");
    view.unmount();
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[true, false], [false, true], [true, true], [false, false]])("applies independent choices: releases=%s statistics=%s", (releases, statistics) => {
    mount();
    if (releases) fireEvent.click(screen.getByRole("switch", { name: "Check for kview updates" }));
    if (statistics) fireEvent.click(screen.getByRole("switch", { name: "Share anonymous installation statistics" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(statisticsConsent()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    expect(screen.getByTestId("release-enabled").textContent).toBe(String(releases));
    expect(statisticsConsent()).toBe(statistics);
    expect(fetch).toHaveBeenCalledTimes(statistics ? 1 : 0);
    expect(localStorage.getItem(key)).toBe("done");
  });

  it.each(["release", "statistics"])("preserves existing %s preference and permanently suppresses invitation even before readiness", (preference) => {
    const settings = defaultUserSettings();
    settings.appearance.releaseChecksEnabled = preference === "release";
    saveUserSettings(settings);
    setStatisticsConsent(preference === "statistics");
    const view = mount(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(key)).toBe("done");
    expect(statisticsConsent()).toBe(preference === "statistics");
    expect(screen.getByTestId("release-enabled").textContent).toBe(String(preference === "release"));
    view.unmount();
    saveUserSettings(defaultUserSettings());
    setStatisticsConsent(false);
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for readiness without recording a decision and honors decisions from another tab", () => {
    const view = mount(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    view.rerender(<UserSettingsProvider><Harness ready /></UserSettingsProvider>);
    expect(screen.getByRole("dialog", { name: "Optional updates and statistics" })).toBeTruthy();
    expect(document.querySelectorAll("#outreach-title")).toHaveLength(1);
    act(() => { localStorage.setItem(key, "done"); window.dispatchEvent(new StorageEvent("storage")); });
    view.unmount();
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not invite when reading storage fails", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed before either opt-in when persisting the decision fails, including remount", () => {
    const view = mount();
    screen.getAllByRole("switch").forEach((input) => fireEvent.click(input));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) {
      if (name === key) throw new Error("quota");
      setItem.call(this, name, value);
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    expect(screen.getByTestId("release-enabled").textContent).toBe("false");
    expect(statisticsConsent()).toBe(false);
    view.unmount();
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
