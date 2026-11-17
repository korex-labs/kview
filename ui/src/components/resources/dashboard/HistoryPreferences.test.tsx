// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardHistoryTab from "./DashboardHistoryTab";
import { UserSettingsProvider, useUserSettings } from "../../../settingsContext";
import { defaultUserSettings, loadUserSettings, saveUserSettings, USER_SETTINGS_KEY } from "../../../settings";
import { normalizeHistoryPreferences } from "../../../historyPreferences";
import { queryFromTrendURL, trendFixture } from "./signalTrends.testFixtures";

// This suite owns preferences/lifecycle; real charts have separate coverage.
vi.mock("./SignalTrendsChart", () => ({ default: () => <div /> }));
const props = { token: "synthetic-token", context: "synthetic-a", active: true };
const node = '["synthetic-worker","synthetic-uid"]';
const fetchMock = vi.fn();
const calls = () => fetchMock.mock.calls.filter(([path]) => path.startsWith("/api/history/signal-trends?"));
const query = () => { const requests = calls(); const [path, init] = requests[requests.length - 1]; return queryFromTrendURL(path, new Headers(init.headers).get("X-Kview-Context")!); };
const loaded = () => screen.findByLabelText("History diagnostics");
function select(name: string, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
function UnrelatedSetting() {
  const { setSettings } = useUserSettings();
  return <button onClick={() => setSettings(old => ({ ...old, logs: { ...old.logs, wrap: !old.logs.wrap } }))}>Unrelated setting</button>;
}
function Shell({ context = props.context, active = true, token = props.token }: { context?: string; active?: boolean; token?: string }) {
  return <UserSettingsProvider><UnrelatedSetting /><DashboardHistoryTab {...props} context={context} token={token} active={active} /></UserSettingsProvider>;
}
beforeEach(() => {
  localStorage.clear(); fetchMock.mockReset();
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    const context = new Headers(init.headers).get("X-Kview-Context")!;
    const data = path === "/api/history/inventory" ? { context, rules: [], nodes: [], namespaces: [], truncated: false } : trendFixture(queryFromTrendURL(path, context));
    if ("severity" in data) data.nodes = data.nodes.map(series => series.key.includes("old-uid") ? {
      ...series, label: series.key, totalScore: 0, changesScore: 0,
      points: series.points.map(point => ({ ...point, counts: null, sampleAt: "0001-01-01T00:00:00Z", sourceAt: "0001-01-01T00:00:00Z", reason: "no-sample" })),
    } : series);
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("normalizes invalid stored controls, defaults fresh/remounted Nodes to Top signals, and remembers manually empty Custom", async () => {
  localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify({ ...defaultUserSettings(), history: { days: 999, hours: false, contexts: { [props.context]: { nodesMode: "recent", rulesMode: "invalid", namespaceMode: "invalid" } } } }));
  const view = render(<Shell />); await loaded();
  expect(query()).toMatchObject({ nodesMode: "topSignals10", rulesMode: "topSignals10", namespacesMode: "topSignals10" });
  expect(screen.getByRole("combobox", { name: "Period" }).textContent).toBe("24 hours");
  expect(screen.getByRole("combobox", { name: "Detail" }).textContent).toBe("Hourly");
  view.rerender(<Shell active={false} />); view.rerender(<Shell />); await loaded();
  expect(query().nodesMode).toBe("topSignals10");
  select("Nodes ranking", "Custom"); await loaded();
  cleanup(); render(<Shell />); await loaded();
  expect(query()).toMatchObject({ nodesMode: "custom", nodes: [] });
  expect(loadUserSettings().history.contexts[props.context].nodes).toEqual([]);
  expect(calls()).toHaveLength(4);
});
it("persists manual period/detail/ranking and Node UID through section back and fresh provider reload without write/fetch loops", async () => {
  const view = render(<Shell />); await loaded();
  expect(query().nodesMode).toBe("topSignals10"); expect(calls()).toHaveLength(1);
  select("Period", "7 days"); await loaded();
  select("Detail", "Daily"); expect(calls()).toHaveLength(2);
  select("Signal types ranking", "Top Changes 10"); await loaded();
  select("Nodes ranking", "Custom"); await loaded();
  const field = screen.getByRole("combobox", { name: "Select nodes" });
  fireEvent.mouseDown(field);
  fireEvent.click(await screen.findByRole("option", { name: /synthetic-worker · retained/ })); await loaded();
  fireEvent.keyDown(field, { key: "Escape" });
  expect(query().nodes).toEqual([node]); expect(calls()).toHaveLength(5);
  const saved = loadUserSettings().history;
  fireEvent.change(field, { target: { value: "ephemeral-search" } });
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(screen.getByText("Unrelated setting"));
  await act(async () => {});
  expect(calls()).toHaveLength(5); expect(loadUserSettings().history).toEqual(saved);
  view.rerender(<Shell active={false} />);
  expect(screen.queryByRole("combobox", { name: "Period" })).toBeNull();
  view.rerender(<Shell />); await loaded();
  expect(calls()).toHaveLength(6); expect(query().nodes).toEqual([node]);
  expect((screen.getByRole("combobox", { name: "Select nodes" }) as HTMLInputElement).value).toBe("");
  cleanup(); render(<Shell />); await loaded();
  expect(calls()).toHaveLength(7); expect(query().nodes).toEqual([node]);
  expect(query().rulesMode).toBe("topChanges10");
  expect(screen.getByRole("combobox", { name: "Period" }).textContent).toBe("7 days");
  expect(screen.getByRole("combobox", { name: "Detail" }).textContent).toBe("Daily");
  expect(loadUserSettings().history).toEqual(saved);
});
it("restores independent context filters, explicit empty Custom, and stale UID without substituting another node", async () => {
  const settings = defaultUserSettings();
  const stale = '["synthetic-worker","old-uid"]';
  settings.history = normalizeHistoryPreferences({ days: 30, hours: 6, contexts: {
    "synthetic-a": { nodesMode: "custom", nodes: [stale], namespaceMode: "custom", namespaces: ["synthetic-apps"], rulesMode: "custom", rules: [] },
    "synthetic-b": { nodesMode: "topChanges10", namespaceMode: "custom", namespaces: [] },
  } });
  saveUserSettings(settings);
  const view = render(<Shell />); await loaded();
  expect(query()).toMatchObject({ nodes: [stale], namespaces: ["synthetic-apps"], rulesMode: "custom", rules: [] });
  const field = within(screen.getByLabelText("Nodes chart header")).getByRole("combobox", { name: "Select nodes" });
  fireEvent.mouseDown(field);
  const retained = await screen.findByRole("checkbox", { name: `${stale} · retained` });
  expect((retained as HTMLInputElement).checked).toBe(true);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(loadUserSettings().history.contexts[props.context].nodes).toEqual([stale]);
  view.rerender(<Shell context="synthetic-b" />); await loaded();
  expect(query()).toMatchObject({ nodesMode: "topChanges10", nodes: [], namespacesMode: "custom", namespaces: [] });
  expect(screen.getByRole("combobox", { name: "Period" }).textContent).toBe("30 days");
  view.rerender(<Shell context="synthetic-new" />); await loaded();
  expect(query()).toMatchObject({ nodesMode: "topSignals10", nodes: [], namespacesMode: "topSignals10", namespaces: [] });
  view.rerender(<Shell token="synthetic-renewed" />); await loaded();
  expect(query().nodes).toEqual([stale]);
  expect(loadUserSettings().history).toEqual(settings.history); expect(calls()).toHaveLength(4);
});
it("persists a manually selected namespace tag through provider reload and falls back without losing unavailable tags", async () => {
  const settings = defaultUserSettings(); settings.resourceTags.enabled = true;
  settings.resourceTags.definitions = [{ id: "synthetic-tag", name: "Synthetic team", color: "#123456" }];
  saveUserSettings(settings);
  render(<Shell />); await loaded();
  select("Namespaces ranking", "Tag"); await loaded(); select("Namespace tag", "Synthetic team");
  const saved = loadUserSettings();
  expect(saved.history.contexts[props.context]).toMatchObject({ namespaceMode: "tag", tag: "synthetic-tag" });
  cleanup(); render(<Shell />); await loaded();
  expect(screen.getByRole("combobox", { name: "Namespace tag" }).textContent).toBe("Synthetic team");
  cleanup(); saved.resourceTags.definitions = []; saveUserSettings(saved);
  render(<Shell />); await loaded();
  expect(screen.queryByRole("combobox", { name: "Namespace tag" })).toBeNull();
  expect(query().namespacesMode).toBe("topSignals10");
  expect(loadUserSettings().history).toEqual(saved.history);
  expect(query().namespaces).toEqual([]);
});
