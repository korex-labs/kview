// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardHistoryTab from "./DashboardHistoryTab";
import { UserSettingsProvider, useUserSettings } from "../../../settingsContext";
import { defaultUserSettings, loadUserSettings, saveUserSettings } from "../../../settings";
import { normalizeHistoryPreferences } from "../../../historyPreferences";
import { queryFromTrendURL, trendFixture } from "./signalTrends.testFixtures";

vi.mock("./SignalTrendsChart", () => ({ default: () => <div /> }));
const token = "synthetic-token", context = "synthetic-a";
const definition = { id: "synthetic-tag", name: "Synthetic team", color: "#123456" };
const fetchMock = vi.fn();
const requests = () => fetchMock.mock.calls.filter(([path]) => path.startsWith("/api/history/signal-trends?"));
const query = () => { const all = requests(); const [path, init] = all[all.length - 1]!; return queryFromTrendURL(path, new Headers(init.headers).get("X-Kview-Context")!); };
const flush = async () => { await act(async () => {}); };
function select(name: string, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
function Switches() {
  const { setSettings } = useUserSettings();
  return <>
    <button onClick={() => setSettings(old => ({ ...old, appearance: { ...old.appearance, dashboardFavouriteNamespaceFilters: !old.appearance.dashboardFavouriteNamespaceFilters, dashboardRecentNamespaceFilters: !old.appearance.dashboardRecentNamespaceFilters }, resourceTags: { ...old.resourceTags, enabled: !old.resourceTags.enabled } }))}>Toggle features</button>
    <button onClick={() => setSettings(old => ({ ...old, resourceTags: { ...old.resourceTags, definitions: [] } }))}>Remove tags</button>
    <button onClick={() => setSettings(old => ({ ...old, resourceTags: { ...old.resourceTags, definitions: [definition] } }))}>Restore tags</button>
    <button onClick={() => setSettings(old => ({ ...old, resourceTags: { ...old.resourceTags, definitions: [{ ...definition, id: "synthetic-replacement" }] } }))}>Replace tag</button>
  </>;
}
function Shell({ activeContext = context, favourite = "synthetic-favourite" }: { activeContext?: string; favourite?: string }) {
  return <UserSettingsProvider><Switches /><DashboardHistoryTab token={token} context={activeContext} active favouriteNamespaces={[favourite]} recentNamespaces={["synthetic-recent"]} namespaceInventory={{ context, token, items: [{ name: "synthetic-apps" }] }} /></UserSettingsProvider>;
}
beforeEach(() => {
  localStorage.clear(); fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    const active = new Headers(init.headers).get("X-Kview-Context")!;
    const data = path === "/api/history/inventory" ? { context: active, rules: [], nodes: [], namespaces: [], truncated: false } : path === "/api/dataplane/signals/catalog" ? { active, items: [] } : trendFixture(queryFromTrendURL(path, active));
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each(["favourites", "recent", "tag"] as const)("projects disabled saved %s to Top High, preserves it through edits/reload and restores on enable", async mode => {
  const settings = defaultUserSettings();
  settings.resourceTags.enabled = false;
  settings.resourceTags.definitions = [definition];
  settings.resourceTags.assignments = { [`${context}/namespaces//synthetic-apps`]: [definition.id] };
  // These are unrelated sidebar/sorting switches, not dashboard filter gates.
  settings.appearance.recentMenuEnabled = true; settings.appearance.smartNamespaceSorting = true;
  settings.history = normalizeHistoryPreferences({ contexts: { [context]: { namespaceMode: mode, tag: definition.id, namespaces: ["must-not-be-custom-fallback"], rulesMode: "custom", rules: [], nodesMode: "topChanges10" } } });
  saveUserSettings(settings);
  const view = render(<Shell />); await flush();
  expect(query()).toMatchObject({ namespacesMode: "topHigh10", namespaces: [], rulesMode: "custom", rules: [], nodesMode: "topChanges10" });
  expect(screen.getByText(/ranking is unavailable; showing Top High 10/)).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Namespaces ranking" }));
  for (const name of ["Favourites", "Recent", "Tag"]) expect(screen.queryByRole("option", { name })).toBeNull();
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  expect(screen.queryByRole("combobox", { name: "Namespace tag" })).toBeNull();
  view.rerender(<Shell favourite="synthetic-changed" />); await flush();
  expect(requests()).toHaveLength(1);
  select("Detail", "Daily"); await flush();
  expect(requests()).toHaveLength(1);
  expect(loadUserSettings().history.contexts).toEqual(settings.history.contexts);
  cleanup(); render(<Shell />); await flush();
  fireEvent.click(screen.getByText("Toggle features")); await flush();
  expect(query()).toMatchObject({ namespacesMode: mode, namespaces: [mode === "tag" ? "synthetic-apps" : mode === "recent" ? "synthetic-recent" : "synthetic-favourite"] });
  expect(loadUserSettings().history.contexts).toEqual(settings.history.contexts);
  expect(loadUserSettings().resourceTags.assignments).toEqual(settings.resourceTags.assignments);
  fireEvent.click(screen.getByText("Toggle features")); await flush();
  expect(query()).toMatchObject({ namespacesMode: "topHigh10", namespaces: [] });
  expect(requests()).toHaveLength(4);
  expect(fetchMock.mock.calls.every(([path]) => path.startsWith("/api/history/") || path === "/api/dataplane/signals/catalog")).toBe(true);
});
it("falls back for missing definitions, restores the saved tag, and rejects cached inventory across contexts", async () => {
  const settings = defaultUserSettings(); settings.resourceTags.enabled = true;
  settings.resourceTags.definitions = [definition];
  settings.resourceTags.assignments = { [`${context}/namespaces//synthetic-apps`]: [definition.id] };
  settings.history = normalizeHistoryPreferences({ contexts: { [context]: { namespaceMode: "tag", tag: definition.id }, "synthetic-b": { namespaceMode: "tag", tag: definition.id }, "synthetic-c": { namespaceMode: "custom", namespaces: [] } } });
  saveUserSettings(settings);
  const view = render(<Shell />); await flush();
  expect(query().namespaces).toEqual(["synthetic-apps"]);
  fireEvent.click(screen.getByText("Remove tags")); await flush();
  expect(query()).toMatchObject({ namespacesMode: "topHigh10", namespaces: [] });
  expect(screen.queryByRole("combobox", { name: "Namespace tag" })).toBeNull();
  fireEvent.click(screen.getByText("Restore tags")); await flush();
  expect(query()).toMatchObject({ namespacesMode: "tag", namespaces: ["synthetic-apps"] });
  view.rerender(<Shell activeContext="synthetic-b" />); await flush();
  expect(query()).toMatchObject({ context: "synthetic-b", namespacesMode: "tag", namespaces: [] });
  expect(screen.getByText(/Inventory unavailable for this context/)).toBeTruthy();
  view.rerender(<Shell activeContext="synthetic-c" />); await flush();
  expect(query()).toMatchObject({ namespacesMode: "custom", namespaces: [] });
  view.rerender(<Shell />); await flush();
  fireEvent.click(screen.getByText("Replace tag")); await flush();
  expect(query()).toMatchObject({ namespacesMode: "topHigh10", namespaces: [] });
  expect(loadUserSettings().history).toEqual(settings.history);
  // An explicit choice can replace a removed tag; automatic fallback cannot.
  select("Namespaces ranking", "Tag"); await flush();
  expect(screen.getByRole("combobox", { name: "Namespace tag" })).toBeTruthy();
  expect(loadUserSettings().history.contexts[context].tag).toBe("");
  expect(query().namespaces).toEqual([]);
});
