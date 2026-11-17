// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardHistoryTab from "./DashboardHistoryTab";

import { carriedTrendFixture, queryFromTrendURL, trendFixture } from "./signalTrends.testFixtures";
import { UserSettingsProvider } from "../../../settingsContext";
import { defaultUserSettings, saveUserSettings } from "../../../settings";
const props = { token: "synthetic-token", context: "synthetic-context", active: true };
const fetchMock = vi.fn();
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function reply(path: string, init: RequestInit) { if (path === "/api/dataplane/signals/catalog") return json({ active: props.context, items: [{ type: "synthetic_rule", label: "Pods awaiting scheduling" }] }); if (path === "/api/history/inventory") return json({ context: new Headers(init.headers).get("X-Kview-Context"), rules: [], nodes: [], namespaces: [], truncated: false }); return json(trendFixture(queryFromTrendURL(path, new Headers(init.headers).get("X-Kview-Context")!))); }
function select(label: string, value: string) { fireEvent.mouseDown(screen.getByRole("combobox", { name: label })); fireEvent.click(screen.getByRole("option", { name: value })); }
function trendCalls() { return fetchMock.mock.calls.filter(([path]) => path.startsWith("/api/history/signal-trends?")); }
function lastQuery() { const [path, init] = trendCalls()[trendCalls().length - 1]; return queryFromTrendURL(path, new Headers(init.headers).get("X-Kview-Context")!); }
async function loaded() { await screen.findByLabelText("History diagnostics"); }
beforeEach(() => { localStorage.clear(); fetchMock.mockReset(); fetchMock.mockImplementation(reply); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([{ token: "" }, { context: "" }, { active: false }])("does not fetch without prerequisites: %o", override => {
  render(<DashboardHistoryTab {...props} {...override} />); expect(fetchMock).not.toHaveBeenCalled();
});
it("uses catalog names in legends and selected/searchable filters while sending unchanged rule keys", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  expect(within(screen.getByLabelText("Signal types legend")).getByText("Pods awaiting scheduling")).toBeTruthy();
  expect(screen.getByLabelText("Signal types legend").textContent).not.toContain("synthetic_rule");
  select("Signal types ranking", "Custom"); await loaded();
  const field = screen.getByRole("combobox", { name: "Select signal types" });
  fireEvent.change(field, { target: { value: "awaiting" } });
  fireEvent.click(await screen.findByRole("option", { name: /Pods awaiting scheduling/ })); await loaded();
  expect(lastQuery().rules).toEqual(["synthetic_rule"]);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(within(screen.getByLabelText("Signal types chart header")).getByText("Pods awaiting scheduling")).toBeTruthy();
  select("Period", "7 days"); await loaded();
  expect(lastQuery().rules).toEqual(["synthetic_rule"]);
  expect(within(screen.getByLabelText("Signal types legend")).getByText("Pods awaiting scheduling")).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dataplane/signals/catalog")).toHaveLength(1);
});
it.each(["Signal types", "Nodes", "Namespaces"])("uses stacked bars only for %s Top Changes and returns to High lines", async title => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  const card = screen.getByLabelText(`${title} chart header`).parentElement!;
  expect(card.querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
  select(`${title} ranking`, "Top Changes 10"); await loaded();
  expect(card.querySelectorAll(".MuiBarChart-element")).toHaveLength(1);
  expect(card.querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  select(`${title} ranking`, "Top High 10"); await loaded();
  expect(card.querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
  expect(card.querySelectorAll(".MuiBarChart-element")).toHaveLength(0);
});
it("ignores a late catalog response after context change and labels retained unknown selections readably", async () => {
  const settings = defaultUserSettings();
  settings.history.contexts["synthetic-other"] = { rulesMode: "custom", rules: ["retired_rule"], nodesMode: "topHigh10", nodes: [], namespaceMode: "topHigh10", namespaces: [], tag: "" };
  saveUserSettings(settings);
  let resolveOld!: (value: Response) => void;
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    const context = new Headers(init.headers).get("X-Kview-Context");
    if (path === "/api/dataplane/signals/catalog") return context === props.context ? new Promise<Response>(resolve => { resolveOld = resolve; }) : json({ active: context, items: [] });
    return reply(path, init);
  });
  const view = render(<UserSettingsProvider><DashboardHistoryTab {...props} /></UserSettingsProvider>); await loaded();
  view.rerender(<UserSettingsProvider><DashboardHistoryTab {...props} context="synthetic-other" /></UserSettingsProvider>); await loaded();
  await act(async () => resolveOld(json({ active: props.context, items: [{ type: "retired_rule", label: "Wrong context label" }] })));
  expect(screen.queryByText("Wrong context label")).toBeNull();
  expect(within(screen.getByLabelText("Signal types legend")).getByText("Retired rule")).toBeTruthy();
  expect(lastQuery().rules).toEqual(["retired_rule"]);
});
it("renders four simultaneous charts, three severity lines, factual diagnostics, no old controls/table/Timeline", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  expect(trendCalls()).toHaveLength(1);
  const [path, init] = trendCalls()[0];
  expect(path).toContain("/api/history/signal-trends?");
  expect(new Headers(init.headers).get("Authorization")).toBe("Bearer synthetic-token");
  expect(new Headers(init.headers).get("X-Kview-Context")).toBe(props.context);
  expect(screen.getAllByLabelText(/chart; UTC; unknown intervals are gaps/)).toHaveLength(4);
  const severity = screen.getByLabelText(/^Severity chart;/);
  expect(severity.querySelectorAll(".MuiLineChart-line")).toHaveLength(3);
  expect(severity.querySelector('[data-observation="isolated"]')).not.toBeNull();
  for (const name of ["Signal scope", "Node lane", "Signal rule", "Signal measure"]) expect(screen.queryByRole("combobox", { name })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull(); expect(screen.queryByText(/Timeline/)).toBeNull();
  expect(screen.getByText("Scopes 3/5")).toBeTruthy(); expect(screen.getByText("Cap losses 2")).toBeTruthy();
  expect(screen.queryByText(/Coverage details/)).toBeNull();
  expect(screen.queryByText(/^Snapshots /)).toBeNull();
  expect(screen.queryByText(/supported · .*unsupported/)).toBeNull();
  expect(screen.getByText(/^Incomplete hours /).closest(".MuiChip-root")?.className).toContain("MuiChip-colorWarning");
  expect(screen.getByText("Cap losses 2").closest(".MuiChip-root")?.className).toContain("MuiChip-colorWarning");
  expect(screen.queryByText(/stale-source|source-cap/)).toBeNull();
  // Real-library interaction/scale/DOM bounds are covered in SignalTrendsChart.test.
});
it("keeps recorded history visible with zero legacy snapshots and hides zero losses", async () => {
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    if (path === "/api/history/inventory") return reply(path, init);
    const data = trendFixture(queryFromTrendURL(path, props.context));
    data.diagnostics.snapshotCount = 0;
    data.diagnostics.capLosses = 0;
    data.diagnostics.unsupportedRules = Array.from({ length: 10 }, (_, i) => `synthetic_detail_${i}`);
    return json(data);
  });
  render(<DashboardHistoryTab {...props} />); await loaded();
  const diagnostics = screen.getByLabelText("History diagnostics");
  expect(within(diagnostics).getByText(/^Last observation /)).toBeTruthy();
  expect(within(diagnostics).getByText("Persisted 1h · 2048 B")).toBeTruthy();
  expect(within(diagnostics).queryByText(/Snapshots|Cap losses|unsupported|Coverage details/)).toBeNull();
  expect(within(diagnostics).getByText(/^Incomplete hours /).closest(".MuiChip-root")?.className).toContain("MuiChip-colorWarning");
  expect(screen.getByLabelText(/^Severity chart;/).querySelectorAll(".MuiLineChart-line")).toHaveLength(3);
});
it("shows a concise information tooltip without internal diagnostics", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  fireEvent.mouseOver(screen.getByRole("button", { name: "More information" }));
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toBe("Signal counts are last observed values, not live readings; changes count confirmed transitions and may be incomplete, while gaps mean no data, not zero.");
});
it("keeps publication diagnostics below four charts without adding filter controls", async () => {
  fetchMock.mockImplementation((path: string, init: RequestInit) => path === "/api/history/inventory" ? reply(path, init) : json(carriedTrendFixture(queryFromTrendURL(path, props.context))));
  render(<DashboardHistoryTab {...props} />); await loaded();
  const diagnostics = screen.getByLabelText("History diagnostics");
  expect(within(diagnostics).getByText("Carried hours 24")).toBeTruthy();
  expect(screen.queryAllByText(/Last known values include carried or stale observations\./)).toHaveLength(0);
  expect(screen.queryAllByText(/Partial or unknown coverage — observed subtotals, not complete totals\./)).toHaveLength(0);
  expect(within(diagnostics).getByText("Coalesced 3")).toBeTruthy();
  expect(within(diagnostics).getByText("Queue overflow 1")).toBeTruthy();
  expect(within(diagnostics).getByText(/^Last observation/)).toBeTruthy();
  expect(screen.getAllByLabelText(/chart; UTC; unknown intervals are gaps/)).toHaveLength(4);
  expect(screen.getByLabelText("Namespaces chart header").compareDocumentPosition(diagnostics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("shares a wrapping title/action header and fixed plot height across all four cards", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  for (const title of ["Severity", "Signal types", "Nodes", "Namespaces"]) {
    const header = screen.getByLabelText(`${title} chart header`);
    expect(within(header).getByText(title).parentElement).toBe(header);
    const style = getComputedStyle(header);
    expect(style.display).toBe("flex");
    expect(style.flexWrap).toBe("wrap");
    expect(style.alignItems).toBe("center");
    expect(style.minHeight).toBe("40px");
    expect(style.boxSizing).toBe("content-box");
    const chart = within(header.parentElement!).getByLabelText(`${title} chart; UTC; unknown intervals are gaps`);
    expect(getComputedStyle(chart).height).toBe("240px");
    expect(getComputedStyle(header.parentElement!).minWidth).toBe("0px");
    if (title === "Severity") expect(within(header).queryByRole("combobox")).toBeNull();
    else {
      const ranking = within(header).getByRole("combobox", { name: `${title} ranking` });
      const actions = ranking.closest(".MuiFormControl-root")!.parentElement!;
      expect(actions.parentElement).toBe(header);
      expect(getComputedStyle(actions).marginLeft).toBe("auto");
      expect(getComputedStyle(actions).flexWrap).toBe("wrap");
      expect(getComputedStyle(actions).maxWidth).toBe("100%");
      expect(getComputedStyle(actions).minWidth).toBe("0px");
    }
  }
  // jsdom cannot measure wrapping: assert the mounted responsive CSS contract,
  // not fabricated desktop/mobile bounding rectangles.
  for (const title of ["Signal types", "Nodes", "Namespaces"]) {
    select(`${title} ranking`, "Custom"); await loaded();
    const header = screen.getByLabelText(`${title} chart header`);
    const custom = within(header).getByRole("combobox", { name: `Select ${title === "Signal types" ? "signal types" : title.toLowerCase()}` });
    const picker = custom.closest(".MuiAutocomplete-root")!;
    expect(getComputedStyle(picker).maxWidth).toBe("100%");
    expect(getComputedStyle(picker).minWidth).toBe("0px");
    expect(getComputedStyle(picker).width).toBe("200px");
    expect(getComputedStyle(picker).flexGrow).toBe("0");
    expect(getComputedStyle(picker).flexShrink).toBe("0");
    const ranking = within(header).getByRole("combobox", { name: `${title} ranking` }).closest(".MuiFormControl-root")!;
    expect(ranking.parentElement).toBe(picker.parentElement);
    expect(ranking.nextElementSibling).toBe(picker);
    expect(getComputedStyle(ranking).width).toBe("165px");
    const actions = picker.parentElement!;
    // Intrinsic width reserves space for BOTH controls, not a percentage minimum
    // resolved against the shrink-to-fit action slot. Max-width + wrap handles
    // narrow cards without forcing a full-width picker on desktop.
    expect(getComputedStyle(actions).width).toBe("max-content");
    expect(getComputedStyle(actions).flexBasis).toBe("auto");
    expect(getComputedStyle(actions).flexShrink).toBe("1");
    expect(getComputedStyle(actions).flexWrap).toBe("wrap");
  }
});
it("uses period-fixed rankings in a single request and detail is display-only", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  select("Signal types ranking", "Top Changes 10"); await loaded();
  expect(lastQuery().rulesMode).toBe("topChanges10"); expect(trendCalls()).toHaveLength(2);
  select("Detail", "Daily"); expect(trendCalls()).toHaveLength(2);
  select("Period", "7 days"); await loaded();
  expect(Date.parse(lastQuery().to) - Date.parse(lastQuery().from)).toBe(7 * 24 * 3600000);
  expect(trendCalls()).toHaveLength(3);
});
it("offers Node Top High alongside Top Changes and Custom, preserving the default and request contract", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  expect(lastQuery().nodesMode).toBe("topHigh10");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Nodes ranking" }));
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["Top High 10", "Top Changes 10", "Custom"]);
  fireEvent.click(screen.getByRole("option", { name: "Top High 10" })); await loaded();
  expect(lastQuery().nodesMode).toBe("topHigh10");
  expect(lastQuery().nodes).toEqual([]);
  const calls = trendCalls();
  const path = calls[calls.length - 1][0];
  expect(new URL(path, "http://fixture.invalid").searchParams.get("nodesMode")).toBe("topHigh10");
  const header = screen.getByLabelText("Nodes chart header");
  expect(within(header).getByText("Nodes").textContent).toBe("Nodes");
  expect(within(header).queryByRole("combobox", { name: "Select nodes" })).toBeNull();
  select("Nodes ranking", "Top Changes 10"); await loaded();
  expect(lastQuery().nodesMode).toBe("topChanges10");
});
it("hides Top High signal types with other severity changes but retains the independent Changes plot", async () => {
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    if (path === "/api/history/inventory") return reply(path, init);
    const data = trendFixture(queryFromTrendURL(path, props.context));
    for (const series of data.rules) {
      series.highScore = 0;
      for (const point of series.points) if (point.counts) {
        point.counts.high = 0; point.coverage = "complete";
        point.confirmedChanges = point.counts.changes; point.changesCoverage = "unknown";
      }
    }
    return json(data);
  });
  render(<DashboardHistoryTab {...props} />); await loaded();
  const card = screen.getByLabelText("Signal types chart header").parentElement!;
  expect(within(card).getByText("1 zero-only series hidden.").title).toContain("plotted measure");
  expect(card.querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  select("Signal types ranking", "Top Changes 10"); await loaded();
  expect(card.querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  expect(card.querySelectorAll(".MuiBarChart-element").length).toBeGreaterThan(0);
  expect(within(card).queryByText(/zero-only series hidden/)).toBeNull();
});
it("offers only discovered node UID keys, selects custom without live inventory calls", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  select("Nodes ranking", "Custom"); await loaded(); expect(lastQuery().nodes).toEqual([]);
  const field = screen.getByRole("combobox", { name: "Select nodes" });
  fireEvent.mouseDown(field); fireEvent.change(field, { target: { value: "synthetic" } });
  fireEvent.click(await screen.findByRole("option", { name: /synthetic-worker · retained/ })); await loaded();
  expect(lastQuery().nodes).toEqual(['["synthetic-worker","synthetic-uid"]']);
  expect(fetchMock.mock.calls.every(([path]) => (path.startsWith("/api/history/") || path === "/api/dataplane/signals/catalog"))).toBe(true);
});
it("hides zero-only auto and Custom lines without clearing selected checkboxes or severity", async () => {
  fetchMock.mockImplementation((path: string, init: RequestInit) => {
    if (path === "/api/history/inventory") return reply(path, init);
    const data = trendFixture(queryFromTrendURL(path, props.context));
    for (const group of [data.severity, data.rules, data.nodes, data.namespaces]) for (const series of group) {
      series.highScore = 0; series.changesScore = 0;
      for (const point of series.points) if (point.counts) {
        point.counts = { high: 0, medium: 0, low: 0, changes: 0 };
        point.coverage = "complete"; point.changesCoverage = "complete";
      }
    }
    return json(data);
  });
  render(<DashboardHistoryTab {...props} />); await loaded();
  expect(screen.getByLabelText(/^Signal types chart;/).querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  expect(screen.getByLabelText(/^Severity chart;/).querySelectorAll(".MuiLineChart-line")).toHaveLength(3);
  for (const label of ["High", "Medium", "Low"]) expect(within(screen.getByLabelText("Severity legend")).getByText(label)).toBeTruthy();
  select("Nodes ranking", "Custom"); await loaded();
  const field = screen.getByRole("combobox", { name: "Select nodes" });
  fireEvent.mouseDown(field); fireEvent.change(field, { target: { value: "synthetic" } });
  fireEvent.click(await screen.findByRole("option", { name: /synthetic-worker · retained/ })); await loaded();
  const selected = ['["synthetic-worker","synthetic-uid"]'];
  expect(lastQuery().nodes).toEqual(selected);
  expect(screen.getByLabelText(/^Nodes chart;/).querySelectorAll(".MuiLineChart-line")).toHaveLength(0);
  expect((await screen.findByRole("checkbox", { name: /synthetic-worker · retained/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.keyDown(field, { key: "Escape" });
  select("Period", "7 days"); await loaded();
  expect(lastQuery().nodes).toEqual(selected);
  fireEvent.mouseDown(field);
  expect((await screen.findByRole("checkbox", { name: /synthetic-worker · retained/ }) as HTMLInputElement).checked).toBe(true);
});
it("uses current-context favourites/recent and reloads when they change", async () => {
  const settings = defaultUserSettings();
  settings.appearance.dashboardFavouriteNamespaceFilters = true;
  settings.appearance.dashboardRecentNamespaceFilters = true;
  saveUserSettings(settings);
  const shell = (context = props.context, favourites = ["synthetic-favourite"], recent = ["synthetic-recent"]) => <UserSettingsProvider><DashboardHistoryTab {...props} context={context} favouriteNamespaces={favourites} recentNamespaces={recent} /></UserSettingsProvider>;
  const view = render(shell()); await loaded();
  select("Namespaces ranking", "Favourites"); await loaded(); expect(lastQuery().namespaces).toEqual(["synthetic-favourite"]);
  view.rerender(shell(props.context, ["synthetic-next"])); await loaded(); expect(lastQuery().namespaces).toEqual(["synthetic-next"]);
  select("Namespaces ranking", "Recent"); await loaded(); expect(lastQuery().namespaces).toEqual(["synthetic-recent"]);
  view.rerender(shell("synthetic-other-context", [], [])); await loaded();
  select("Namespaces ranking", "Favourites"); await loaded(); expect(lastQuery().namespaces).toEqual([]);
});
it("hides disabled tag mode and resolves enabled tags only from actual same-identity cached inventory", async () => {
  const settings = defaultUserSettings(); settings.resourceTags.enabled = true;
  settings.resourceTags.definitions = [{ id: "synthetic-tag", name: "Synthetic team", color: "#123456" }];
  settings.resourceTags.assignments = { "synthetic-context/namespaces//synthetic-apps": ["synthetic-tag"], "synthetic-context/namespaces//not-in-inventory": ["synthetic-tag"] };
  saveUserSettings(settings);
  render(<UserSettingsProvider><DashboardHistoryTab {...props} namespaceInventory={{ context: props.context, token: props.token, items: [{ name: "synthetic-apps" }] }} /></UserSettingsProvider>); await loaded();
  select("Namespaces ranking", "Tag"); await loaded(); select("Namespace tag", "Synthetic team"); await loaded();
  expect(lastQuery().namespaces).toEqual(["synthetic-apps"]);
  const header = screen.getByLabelText("Namespaces chart header");
  const tagControl = within(header).getByRole("combobox", { name: "Namespace tag" }).closest(".MuiFormControl-root")!;
  const ranking = within(header).getByRole("combobox", { name: "Namespaces ranking" }).closest(".MuiFormControl-root")!;
  expect(ranking.nextElementSibling).toBe(tagControl);
  expect(getComputedStyle(tagControl).width).toBe("150px");
  expect(getComputedStyle(tagControl).minWidth).toBe("0px");
  expect(getComputedStyle(tagControl.parentElement!).width).toBe("max-content");
  expect(getComputedStyle(tagControl.parentElement!).flexWrap).toBe("wrap");
  expect(fetchMock.mock.calls.every(([path]) => (path.startsWith("/api/history/") || path === "/api/dataplane/signals/catalog"))).toBe(true);
  cleanup(); settings.resourceTags.enabled = false; saveUserSettings(settings);
  render(<UserSettingsProvider><DashboardHistoryTab {...props} /></UserSettingsProvider>); await loaded();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Namespaces ranking" })); expect(screen.queryByRole("option", { name: "Tag" })).toBeNull();
});
it.each(["context", "token", "active"] as const)("cancels %s changes and ignores late success", async field => {
  let resolve!: (r: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  const view = render(<DashboardHistoryTab {...props} />), [path, init] = fetchMock.mock.calls[0];
  view.rerender(<DashboardHistoryTab {...props} {...{ [field]: field === "active" ? false : "synthetic-new" }} />);
  expect(init.signal.aborted).toBe(true); if (field !== "active") await loaded();
  await act(async () => { const old = await reply(path, init).json(); old.diagnostics.capLosses = 999; resolve(json(old)); });
  expect(screen.queryByText("Cap losses 999")).toBeNull();
});
it("cancels filter changes, ignores late failure, aborts unmount", async () => {
  render(<DashboardHistoryTab {...props} />); await loaded();
  let reject!: (e: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((_, r) => { reject = r; }));
  select("Signal types ranking", "Top Changes 10");
  const old = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].signal as AbortSignal;
  select("Signal types ranking", "Top High 10"); await loaded(); expect(old.aborted).toBe(true);
  await act(async () => reject(new Error("synthetic-late-error"))); expect(screen.queryByText(/synthetic-late-error/)).toBeNull();
  fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
  select("Signal types ranking", "Top Changes 10");
  const current = trendCalls()[trendCalls().length - 1][1].signal as AbortSignal;
  cleanup(); expect(current.aborted).toBe(true);
});
it("rejects mismatched data, retries and keeps consent explicit without writes", async () => {
  fetchMock.mockImplementation((path, init) => path === "/api/history/inventory" ? reply(path, init) : json({ context: "wrong" }));
  render(<DashboardHistoryTab {...props} />); await screen.findByText(/Invalid or mismatched/);
  fetchMock.mockImplementation(reply);
  fireEvent.click(screen.getByRole("button", { name: "Retry signals" })); await loaded();
  fetchMock.mockImplementation((path, init) => path === "/api/history/inventory" ? reply(path, init) : json({ error: "off" }, 409)); fireEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  await screen.findByText(/Signal history is off/);
  expect(screen.queryByLabelText("History diagnostics")).toBeNull();
  expect(fetchMock.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
});
it("blocks selection overflow rather than silently truncating favourites", async () => {
  const settings = defaultUserSettings(); settings.appearance.dashboardFavouriteNamespaceFilters = true; saveUserSettings(settings);
  render(<UserSettingsProvider><DashboardHistoryTab {...props} favouriteNamespaces={Array.from({ length: 21 }, (_, i) => `synthetic-${i}`)} /></UserSettingsProvider>); await loaded();
  select("Namespaces ranking", "Favourites"); await screen.findByText(/exceeds the API limit/);
  await waitFor(() => expect(trendCalls()).toHaveLength(1));
  expect(within(screen.getByRole("combobox", { name: "Namespaces ranking" })).getByText("Favourites")).toBeTruthy();
});
