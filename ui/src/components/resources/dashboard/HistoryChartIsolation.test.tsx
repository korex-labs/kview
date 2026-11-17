// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardHistoryTab from "./DashboardHistoryTab";
import { queryFromTrendURL, trendFixture } from "./signalTrends.testFixtures";
import type { SignalTrends } from "./signalTrends";
import { UserSettingsProvider, useUserSettings } from "../../../settingsContext";
import { defaultUserSettings, saveUserSettings } from "../../../settings";

const props = { context: "synthetic-context", token: "synthetic-token", active: true };
const titles = ["Severity", "Signal types", "Nodes", "Namespaces"];
const fetchMock = vi.fn();
const pending: { data: SignalTrends; signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
let defer = false;
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const card = (title: string) => screen.getByLabelText(`${title} chart header`).parentElement!;
const chart = (title: string) => within(card(title)).getByLabelText(`${title} chart; UTC; unknown intervals are gaps`).querySelector("svg")!;
function select(title: string, value: string) {
  const root = titles.includes(title) ? card(title) : document.body;
  fireEvent.mouseDown(within(root).getByRole("combobox", { name: titles.includes(title) ? `${title} ranking` : title }));
  fireEvent.click(screen.getByRole("option", { name: value }));
}
const flush = () => act(async () => {});
async function finish(index: number) { await act(async () => pending[index].resolve(json(pending[index].data))); }
function retain(titles: string[]) {
  const entries = titles.map(title => ({ title, svg: chart(title), html: chart(title).innerHTML, legend: screen.getByLabelText(`${title} legend`) }));
  return () => entries.forEach(({ title, svg, html, legend }) => {
    expect(chart(title)).toBe(svg);
    expect(chart(title).innerHTML).toBe(html);
    expect(screen.getByLabelText(`${title} legend`)).toBe(legend);
    expect(within(card(title)).queryByRole("status", { name: /loading/ })).toBeNull();
  });
}
beforeEach(() => {
  localStorage.clear(); pending.length = 0; defer = false;
  fetchMock.mockReset().mockImplementation((path: string, init: RequestInit) => {
    const context = new Headers(init.headers).get("X-Kview-Context")!;
    if (path === "/api/dataplane/signals/catalog") return json({ active: context, items: [] });
    if (path === "/api/history/inventory") return json({ context, rules: [], nodes: [], namespaces: [], truncated: false });
    const data = trendFixture(queryFromTrendURL(path, context));
    return defer ? new Promise<Response>((resolve, reject) => pending.push({ data, signal: init.signal as AbortSignal, resolve, reject })) : json(data);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["Signal types", "Nodes", "Namespaces"])("keeps other SVG instances, values and legends unchanged while %s ranking loads and commits", async title => {
  render(<DashboardHistoryTab {...props} />); await flush();
  const stable = retain(titles.filter(other => other !== title));
  const previous = chart(title);
  defer = true; select(title, "Top Changes 10");
  stable(); expect(chart(title)).toBe(previous);
  expect(within(card(title)).getByRole("status", { name: /loading/ }).textContent).toContain("Loading");
  expect(screen.queryByText("Loading signal trends…")).toBeNull();
  await finish(0); stable();
  expect(chart(title).querySelectorAll(".MuiBarChart-element")).toHaveLength(1);
  expect(chart(title).querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  expect(screen.queryByRole("status", { name: /loading/ })).toBeNull();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dataplane/signals/catalog")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/history/inventory")).toHaveLength(1);
  // Use the chart's focus target, not the ranking select's tab stop.
  const target = chart(title).parentElement!.querySelector('[tabindex="0"]')!;
  fireEvent.focus(target); fireEvent.keyDown(target, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("4 changes")).toBeTruthy();
});
it("scopes Nodes Custom edits and ignores an obsolete success even when transport ignores abort", async () => {
  render(<DashboardHistoryTab {...props} />); await flush();
  const stable = retain(["Severity", "Signal types", "Namespaces"]);
  defer = true; select("Nodes", "Custom"); stable();
  const field = within(card("Nodes")).getByRole("combobox", { name: "Select nodes" });
  fireEvent.change(field, { target: { value: "synthetic" } });
  fireEvent.click(screen.getByRole("option", { name: /synthetic-worker · retained/ }));
  fireEvent.keyDown(field, { key: "Escape" });
  expect(pending).toHaveLength(2); expect(pending[0].signal.aborted).toBe(true);
  stable(); await finish(1); stable();
  expect(chart("Nodes").querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
  const settled = chart("Nodes").innerHTML;
  await finish(0); stable(); expect(chart("Nodes").innerHTML).toBe(settled);
  expect(within(card("Nodes")).queryByRole("status", { name: /loading/ })).toBeNull();
});
it("keeps a filter failure local, preserves charts and retries only the pending selection", async () => {
  render(<DashboardHistoryTab {...props} />); await flush();
  const stable = retain(["Severity", "Nodes", "Namespaces"]);
  defer = true; select("Signal types", "Top Changes 10");
  await act(async () => pending[0].reject(new Error("synthetic-filter-failure")));
  stable(); expect(within(card("Signal types")).getByRole("alert").textContent).toContain("synthetic-filter-failure");
  expect(chart("Signal types").querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
  fireEvent.click(within(card("Signal types")).getByRole("button", { name: "Retry signals" }));
  await finish(1); stable();
  expect(chart("Signal types").querySelectorAll(".MuiBarChart-element")).toHaveLength(1);
});
it("treats disabled shared history as a global error even during a local selection request", async () => {
  render(<DashboardHistoryTab {...props} />); await flush();
  defer = true; select("Nodes", "Top Changes 10");
  await act(async () => pending[0].resolve(new Response(JSON.stringify({ error: "off" }), { status: 409 })));
  expect(screen.getByRole("alert").textContent).toContain("Signal history is off");
  expect(within(card("Nodes")).queryByRole("alert")).toBeNull();
  expect(screen.queryByLabelText("History diagnostics")).toBeNull();
  for (const title of titles) expect(chart(title).querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
});
it("tracks two pending chart edits against the accepted snapshot and ignores the superseded failure", async () => {
  render(<DashboardHistoryTab {...props} />); await flush();
  const stable = retain(["Severity", "Namespaces"]);
  defer = true; select("Signal types", "Top Changes 10"); select("Nodes", "Top Changes 10");
  expect(pending[0].signal.aborted).toBe(true);
  for (const title of ["Signal types", "Nodes"]) expect(within(card(title)).getByRole("status", { name: /loading/ })).toBeTruthy();
  stable(); await act(async () => pending[0].reject(new Error("obsolete failure")));
  expect(screen.queryByText(/obsolete failure/)).toBeNull();
  expect(screen.getAllByRole("status", { name: /loading/ })).toHaveLength(2);
  await finish(1); stable();
  for (const title of ["Signal types", "Nodes"]) expect(chart(title).querySelectorAll(".MuiBarChart-element")).toHaveLength(1);
});
it("keeps unrelated charts stable through Namespace Tag selection changes", async () => {
  const settings = defaultUserSettings(); settings.resourceTags.enabled = true;
  settings.resourceTags.definitions = [{ id: "synthetic-tag", name: "Synthetic team", color: "#123456" }];
  settings.resourceTags.assignments = { "synthetic-context/namespaces//synthetic-apps": ["synthetic-tag"] };
  saveUserSettings(settings);
  render(<UserSettingsProvider><DashboardHistoryTab {...props} namespaceInventory={{ context: props.context, token: props.token, items: [{ name: "synthetic-apps" }] }} /></UserSettingsProvider>); await flush();
  const stable = retain(["Severity", "Signal types", "Nodes"]);
  defer = true; select("Namespaces", "Tag"); stable(); await finish(0); stable();
  select("Namespace tag", "Synthetic team"); stable(); await finish(1); stable();
  expect(pending[1].data.namespaces[0].key).toBe("synthetic-apps");
  expect(chart("Namespaces").querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
});
function ToggleTags() {
  const { setSettings } = useUserSettings();
  return <button onClick={() => setSettings(old => ({ ...old, resourceTags: { ...old.resourceTags, enabled: !old.resourceTags.enabled } }))}>Toggle tags</button>;
}
it("keeps other SVGs stable when a saved Tag ranking is disabled and restored", async () => {
  const settings = defaultUserSettings(); settings.resourceTags.enabled = true;
  settings.resourceTags.definitions = [{ id: "synthetic-tag", name: "Synthetic team", color: "#123456" }];
  saveUserSettings(settings);
  render(<UserSettingsProvider><ToggleTags /><DashboardHistoryTab {...props} /></UserSettingsProvider>); await flush();
  select("Namespaces", "Tag"); await flush();
  const stable = retain(["Severity", "Signal types", "Nodes"]);
  defer = true;
  fireEvent.click(screen.getByText("Toggle tags")); stable();
  expect(within(card("Namespaces")).getByRole("status", { name: /loading/ })).toBeTruthy();
  await finish(0); stable();
  fireEvent.click(screen.getByText("Toggle tags")); stable();
  await finish(1); stable();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/history/inventory")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dataplane/signals/catalog")).toHaveLength(1);
});
it("publishes genuinely changed shared values without replacing other chart SVGs", async () => {
  render(<DashboardHistoryTab {...props} />); await flush();
  const severity = chart("Severity"), before = severity.innerHTML;
  const stable = retain(["Nodes", "Namespaces"]);
  defer = true; select("Signal types", "Top Changes 10");
  const series = pending[0].data.severity[0]; series.points[0].counts!.high = 9; series.highScore = 9;
  await finish(0); stable();
  expect(chart("Severity")).toBe(severity); expect(severity.innerHTML).not.toBe(before);
  expect(within(card("Severity")).queryByRole("status", { name: /loading/ })).toBeNull();
});
it.each(["context", "token"] as const)("reloads all for period/manual refresh, aggregates detail locally and clears old %s data", async field => {
  const view = render(<DashboardHistoryTab {...props} />); await flush();
  const count = fetchMock.mock.calls.length;
  select("Detail", "Daily"); await flush(); expect(fetchMock.mock.calls).toHaveLength(count);
  defer = true; select("Period", "7 days");
  expect(screen.getByText("Loading signal trends…")).toBeTruthy();
  expect(screen.queryByLabelText("History diagnostics")).toBeNull();
  await finish(0);
  fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  expect(screen.getByText("Loading signal trends…")).toBeTruthy();
  await finish(1);
  select("Nodes", "Custom");
  view.rerender(<DashboardHistoryTab {...props} {...{ [field]: "synthetic-other" }} />);
  expect(pending[2].signal.aborted).toBe(true);
  expect(screen.queryByLabelText("History diagnostics")).toBeNull();
  for (const title of titles) expect(chart(title).querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  await finish(2); expect(screen.queryByLabelText("History diagnostics")).toBeNull();
  await finish(3); expect(screen.getByLabelText("History diagnostics")).toBeTruthy();
});
