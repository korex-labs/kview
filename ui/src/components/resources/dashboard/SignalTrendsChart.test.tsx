// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTheme, ThemeProvider } from "@mui/material";
import SignalTrendsChart from "./SignalTrendsChart";
import { parseSignalTrends, trendLines, type ChartLine, type TrendPoint, type TrendQuery, trendHour } from "./signalTrends";
import wireFixtures from "./testdata/signalTrends.wire.json";

import { carriedTrendFixture, fixtureQuery, trendFixture } from "./signalTrends.testFixtures";

const from = "2026-01-01T00:00:00Z";
let width = 640;
const observers = new Set<() => void>();
// jsdom has no layout/ResizeObserver/SVG matrices. Only supply browser geometry;
// all chart rendering, paths, scales, tooltips and keyboard handling remain real.
beforeEach(() => {
  width = 640;
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    if (!element.classList.contains("MuiChartsSurface-root")) return style;
    return new Proxy(style, { get(target, property) { if (property === "width") return `${width}px`; if (property === "height") return "240px"; const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value; } });
  });
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; }
    observe() { observers.add(this.callback); }
    unobserve() { observers.delete(this.callback); }
    disconnect() { observers.delete(this.callback); }
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 240, width, height: 240, toJSON: () => ({}) }));
});
afterEach(() => { cleanup(); observers.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function points(values: Array<number | null>, coverage: TrendPoint["coverage"] = "complete"): TrendPoint[] {
  return values.map((value, i) => { const at = new Date(Date.parse(from) + i * trendHour).toISOString(); return { at, sampleAt: at, sourceAt: at, counts: value === null ? null : { high: value, medium: 2, low: 3, changes: 1 }, coverage, reason: coverage === "partial" ? "scope-unavailable" : undefined }; });
}
function line(values: Array<number | null>, key = "alpha", coverage: TrendPoint["coverage"] = "complete"): ChartLine { return { key, label: `Series ${key}`, metric: "high", points: points(values, coverage) }; }
function mount(lines: ChartLine[], mode: "light" | "dark" = "light") {
  return render(<ThemeProvider theme={createTheme({ palette: { mode } })}><SignalTrendsChart title="Signals" lines={lines} from={from} to={new Date(Date.parse(from) + (lines[0]?.points.length || 4) * trendHour).toISOString()} hours={1} /></ThemeProvider>);
}
it("uses real library paths with null gaps and visible isolated observations", () => {
  const { container } = mount([line([1, 2, null, 4, null, 0])]);
  const path = container.querySelector(".MuiLineChart-line")!;
  expect(path).not.toBeNull();
  const d = path.getAttribute("d")!;
  expect(d.match(/M/g)).toHaveLength(3);
  expect(d).not.toMatch(/[CQ]/); // linear, no smoothing
  const sparse = container.querySelector('[data-observation="isolated"]')!;
  expect(sparse.getAttribute("d")!.match(/l0,0/g)).toHaveLength(2);
  expect(sparse.getAttribute("stroke-linecap")).toBe("round");
  expect(container.querySelectorAll(".MuiLineChart-mark")).toHaveLength(0);
});
it.each(["light", "dark"] as const)("renders themed axes/grid/legend in %s mode and preserves severity color", mode => {
  const { container } = mount([{ ...line([0, 4, 2]), color: "#d94b48" }], mode);
  expect(container.querySelectorAll(".MuiChartsGrid-line").length).toBeGreaterThan(1);
  expect(container.querySelectorAll(".MuiChartsAxis-tickLabel").length).toBeGreaterThan(2);
  expect(within(screen.getByLabelText("Signals legend")).getByText("Series alpha")).toBeTruthy();
  expect(container.querySelector(".MuiLineChart-line")!.getAttribute("stroke")).toBe("#d94b48");
});
it("shows concise selected series in order through real keyboard axis tooltip", async () => {
  const { container } = mount([line([3, 5, null], "alpha", "partial"), line([7, 8, 9], "beta")]);
  const chart = container.querySelector('[tabindex="0"]')!;
  expect(chart).not.toBeNull();
  fireEvent.focus(chart);
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain("Series alpha");
  expect(tooltip.textContent).toContain("Series beta");
  expect(tooltip.textContent).not.toMatch(/Partial|Last known|Coverage unknown/);
  expect(tooltip.textContent!.indexOf("Series alpha")).toBeLessThan(tooltip.textContent!.indexOf("Series beta"));
  expect(tooltip.textContent).not.toMatch(/scope-unavailable|Source|Sample|Complete|\|N\||H \d|M \d|L \d/);
  expect(within(tooltip).getByText("3 signals")).toBeTruthy();
  expect(within(tooltip).getByText("7 signals")).toBeTruthy();
  expect(tooltip.textContent).toContain("UTC");
  expect(container.querySelector('[data-observation="partial"]')).not.toBeNull();
  fireEvent.keyDown(chart, { key: "End" });
  expect((await screen.findByRole("tooltip")).textContent).toContain("No data");
});
it("shows real pointer axis tooltip and removes it on leave", async () => {
  const { container } = mount([line([3, 5, null], "alpha", "partial"), line([7, 8, 9], "beta")]);
  const chart = container.querySelector(".MuiChartsSurface-root")!;
  fireEvent.pointerEnter(chart, { pointerType: "mouse", clientX: 60, clientY: 70 });
  fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: 60, clientY: 70 });
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain("Series alpha");
  expect(tooltip.textContent).toContain("Series beta");
  expect(tooltip.textContent).not.toMatch(/Partial|Last known|Coverage unknown/);
  expect(tooltip.textContent).not.toMatch(/scope-unavailable|Source|Sample|Complete|\|N\||H \d|M \d|L \d/);
  expect(within(tooltip).getByText("3 signals")).toBeTruthy();
  expect(within(tooltip).getByText("7 signals")).toBeTruthy();
  // MUI's MoveGesture emits moveEnd only for a mouse/pen leave; preserve
  // the entering pointer type instead of jsdom's default empty pointerType.
  fireEvent.pointerLeave(chart, { pointerType: "mouse", relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});
it("retains last active subtotals with degraded coverage across a coarse unknown interval", () => {
  const data = line([1, 2, 3, 4, null, 6], "alpha", "partial");
  const { container } = render(<SignalTrendsChart title="Coarse" lines={[data]} from={from} to="2026-01-01T06:00:00Z" hours={2} />);
  expect(container.querySelector('[data-observation="partial"]')!.getAttribute("d")!.match(/M/g)).toHaveLength(3);
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(screen.getByRole("tooltip").textContent).not.toMatch(/Partial|Last known|Coverage unknown/);
  expect(within(screen.getByRole("tooltip")).getByText("2 signals")).toBeTruthy();
  fireEvent.keyDown(chart, { key: "End" });
  expect(within(screen.getByRole("tooltip")).getByText("6 signals")).toBeTruthy();
});
it.each(["partial", "unknown", undefined] as const)("uses %s changes coverage instead of complete active coverage", changesCoverage => {
  const data = { ...line([3, 5]), metric: "changes" as const };
  data.points = data.points.map(p => ({ ...p, changesCoverage }));
  const { container } = mount([data]);
  expect(container.querySelector('[data-observation="partial"]')).not.toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("1 change")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toMatch(/Partial|Last known|Coverage unknown/);
});
it("uses complete changes coverage despite partial active coverage", () => {
  const data = { ...line([3, 5], "alpha", "partial"), metric: "changes" as const };
  data.points = data.points.map(p => ({ ...p, changesCoverage: "complete" }));
  const { container } = mount([data]);
  expect(container.querySelector('[data-observation="partial"]')).toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("1 change")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toMatch(/Partial|unknown|Complete|scope-unavailable/);
});
it("keeps confirmed changes across coarse unknown intervals without claiming complete totals", () => {
  const data = { ...line([3, null]), metric: "changes" as const };
  data.points = data.points.map(p => ({ ...p, changesCoverage: "complete" }));
  const { container } = render(<SignalTrendsChart title="Changes" lines={[data]} from={from} to="2026-01-01T02:00:00Z" hours={2} />);
  expect(container.querySelector('[data-observation="partial"]')).not.toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("1 change")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toMatch(/Partial|Last known|Coverage unknown/);
});
it("formats counts and keeps missing, zero and singular values distinct without exposing raw identities", () => {
  const selected = { ...line([1234, null, 0, 1], "private-node-uid"), label: "Worker signals" };
  const { container } = mount([selected]);
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText(`${(1234).toLocaleString()} signals`)).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toContain("private-node-uid");
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("No data")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toContain("0 signals");
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("0 signals")).toBeTruthy();
  fireEvent.keyDown(chart, { key: "End" });
  expect(within(screen.getByRole("tooltip")).getByText("1 signal")).toBeTruthy();
});
it("renders parsed retained overnight evidence with clean numeric hover and bounded marks", async () => {
  const data = parseSignalTrends(carriedTrendFixture(fixtureQuery), fixtureQuery);
  const { container } = mount([{ key: "retained", label: "Retained signals", metric: "high", points: data.severity[0].points }]);
  expect(screen.queryByText(/Last known values include carried or stale observations\./)).toBeNull();
  expect(screen.queryByText(/Partial or unknown coverage — observed subtotals, not complete totals\./)).toBeNull();
  expect(container.querySelector('[data-observation="partial"]')).not.toBeNull();
  expect(container.querySelector('[data-observation="carried"]')).not.toBeNull();
  expect(container.querySelector(".MuiLineChart-line")!.getAttribute("d")).not.toContain("NaN");
  const chart = container.querySelector(".MuiChartsSurface-root")!;
  fireEvent.pointerEnter(chart, { pointerType: "mouse", clientX: 60, clientY: 70 });
  fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: 60, clientY: 70 });
  const tooltip = await screen.findByRole("tooltip");
  expect(within(tooltip).getByText("2 signals")).toBeTruthy();
  expect(tooltip.textContent).not.toMatch(/Partial|Last known|Coverage unknown|sourceAge|last-observed|Source|Sample|90000/);
});
it.each(["partial", "unknown"] as const)("plots parsed confirmed changes with %s coverage without active counts or invented unknown zero", changesCoverage => {
  const raw = trendFixture(fixtureQuery), series = raw.nodes[0];
  Object.assign(series.points[0], { counts: null, confirmedChanges: 4, changesCoverage });
  series.highScore = 0;
  const data = parseSignalTrends(raw, fixtureQuery);
  const { container } = mount([{ key: "changes", label: "Node changes", metric: "changes", points: data.nodes[0].points }]);
  expect(container.querySelector('[data-observation="isolated"]')).not.toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("4 changes")).toBeTruthy();
  fireEvent.keyDown(chart, { key: "End" });
  expect(within(screen.getByRole("tooltip")).getByText("No data")).toBeTruthy();
});
it("keeps confirmed changes authoritative and unknown zero distinct from observed zero", () => {
  const data = { ...line([9, 9, 9]), metric: "changes" as const };
  data.points = data.points.map((point, index) => ({ ...point, confirmedChanges: index === 0 ? 4 : 0, changesCoverage: index === 2 ? "complete" : "unknown" }));
  const { container } = mount([data]);
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  const tooltip = screen.getByRole("tooltip");
  expect(within(tooltip).getByText("4 changes")).toBeTruthy();
  expect(tooltip.textContent).not.toMatch(/Partial|Last known|Coverage unknown|1 change|9 signals/);
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("No data")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toContain("0 changes");
  fireEvent.keyDown(chart, { key: "End" });
  expect(within(screen.getByRole("tooltip")).getByText("0 changes")).toBeTruthy();
});
it("plots the generated Go partial-confirmed fixture as changes, not active High counts", () => {
  const fixture = wireFixtures.find(value => value.name === "partial-confirmed-changes")!;
  const data = parseSignalTrends(structuredClone(fixture.response), fixture.query as TrendQuery);
  const lines = trendLines(data.nodes, "topChanges10", "active");
  const { container } = render(<SignalTrendsChart title="Nodes" lines={lines} from={fixture.query.from} to={fixture.query.to} hours={1} />);
  expect(container.querySelector('[data-observation="partial"]')).not.toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("1 change")).toBeTruthy();
});
it.each(["nodes", "namespaces"] as const)("keeps dense %s isolated-dot hover on its confirmed-change observation", async group => {
  width = 220;
  const fixture = wireFixtures.find(value => value.name === "dense-partial-changes")!;
  const data = parseSignalTrends(structuredClone(fixture.response), fixture.query as TrendQuery);
  const lines = trendLines(data[group], "topChanges10", "active");
  expect(lines[0].points.filter(point => (point.confirmedChanges || 0) > 0).map(point => point.confirmedChanges)).toEqual([1, 2]);
  const { container } = render(<SignalTrendsChart title={group} lines={lines} from={fixture.query.from} to={fixture.query.to} hours={1} />);
  const marks = container.querySelector('[data-observation="isolated"]')!.getAttribute("d")!;
  const coordinates = [...marks.matchAll(/M([\d.]+),([\d.]+)l0,0/g)].map(match => [Number(match[1]), Number(match[2])]);
  expect(coordinates).toHaveLength(2);
  const chart = container.querySelector(".MuiChartsSurface-root")!;
  for (const [index, [x, y]] of coordinates.entries()) {
    fireEvent.pointerEnter(chart, { pointerType: "mouse", clientX: x, clientY: y });
    fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: x, clientY: y });
    expect((await screen.findByRole("tooltip")).textContent).toContain(index === 0 ? "1 change" : "2 changes");
    // Still inside the visible 5px isolated dot, but past the neighbouring
    // hourly cell's midpoint in a dense chart.
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1.5, 1.5]]) {
      fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: x + dx, clientY: y + dy });
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain(index === 0 ? "1 change" : "2 changes");
      const observation = lines[0].points.find(point => point.confirmedChanges === index + 1)!;
      expect(tooltip.querySelector("caption")!.textContent).toBe(`${new Date(observation.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`);
    }
    // Same x-cell but no 2D marker hit must remain an honest unknown gap.
    fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: x + 2, clientY: y + 10 });
    expect((await screen.findByRole("tooltip")).textContent).toContain("No data");
    // Beyond the marker, native x-cell selection reaches the other real
    // observation from the first dot, and an unknown hour from the second.
    fireEvent.pointerMove(chart, { pointerType: "mouse", clientX: x + 6, clientY: y });
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain(index === 0 ? "2 changes" : "No data");
    if (index === 0) {
      const otherObservation = lines[0].points.find(point => point.confirmedChanges === 2)!;
      expect(tooltip.querySelector("caption")!.textContent).toBe(`${new Date(otherObservation.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`);
    }
  }
  fireEvent.pointerLeave(chart, { pointerType: "mouse", relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});
it("keeps keyboard navigation native before, during and after a marker hover", async () => {
  const { container } = mount([line([null, 1, null, null, 2, null])]);
  const surface = container.querySelector(".MuiChartsSurface-root")!;
  const keyboard = container.querySelector('[tabindex="0"]')!;
  const coordinates = [...container.querySelector('[data-observation="isolated"]')!.getAttribute("d")!.matchAll(/M([\d.]+),([\d.]+)l0,0/g)];
  const x = Number(coordinates[0][1]), y = Number(coordinates[0][2]);
  fireEvent.focus(keyboard); fireEvent.keyDown(keyboard, { key: "End" });
  expect((await screen.findByRole("tooltip")).textContent).toContain("No data");
  fireEvent.pointerEnter(surface, { pointerType: "mouse", clientX: x, clientY: y });
  fireEvent.pointerMove(surface, { pointerType: "mouse", clientX: x + 2, clientY: y });
  expect(within(await screen.findByRole("tooltip")).getByText("1 signal")).toBeTruthy();
  fireEvent.keyDown(keyboard, { key: "ArrowLeft" });
  expect(within(await screen.findByRole("tooltip")).getByText("2 signals")).toBeTruthy();
  fireEvent.pointerMove(surface, { pointerType: "mouse", clientX: x - 2, clientY: y });
  expect(within(await screen.findByRole("tooltip")).getByText("1 signal")).toBeTruthy();
  fireEvent.pointerLeave(surface, { pointerType: "mouse", relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(keyboard, { key: "ArrowLeft" });
  expect((await screen.findByRole("tooltip")).textContent).toContain("No data");
  fireEvent.keyDown(keyboard, { key: "ArrowRight" });
  expect(within(await screen.findByRole("tooltip")).getByText("2 signals")).toBeTruthy();
});
it("prioritizes the nearest visible marker in two dimensions across dense series", async () => {
  width = 220;
  const a = Array<number | null>(48).fill(null), b = [...a];
  a[12] = 1; b[13] = 2;
  const { container } = mount([line(a, "a"), line(b, "b")]);
  const marks = [...container.querySelectorAll('[data-observation="isolated"]')].map(mark => {
    const match = /M([\d.]+),([\d.]+)/.exec(mark.getAttribute("d")!)!;
    return [Number(match[1]), Number(match[2])];
  });
  const surface = container.querySelector(".MuiChartsSurface-root")!;
  // The pointer is closer in x to the other series, but inside this dot.
  for (const [index, [x, y]] of marks.entries()) {
    fireEvent.pointerEnter(surface, { pointerType: "mouse", clientX: x, clientY: y });
    fireEvent.pointerMove(surface, { pointerType: "mouse", clientX: x + (index === 0 ? 2 : -2), clientY: y });
    const tooltip = await screen.findByRole("tooltip");
    expect(within(tooltip).getByText(index === 0 ? "1 signal" : "2 signals")).toBeTruthy();
    expect(within(tooltip).getByText("No data")).toBeTruthy();
  }
});
it("responds to container resize without rebuilding a fixed-size SVG", async () => {
  const { container } = mount([line([1, 2, 3])]);
  const before = container.querySelector(".MuiLineChart-line")!.getAttribute("d");
  width = 380;
  await act(async () => { observers.forEach(callback => callback()); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(container.querySelector(".MuiLineChart-line")!.getAttribute("d")).not.toBe(before);
});
it("distinguishes empty selection, unknown data and observed zero", () => {
  const empty = mount([]);
  expect(screen.getByText("No selected retained series.")).toBeTruthy();
  empty.unmount();
  const unknown = mount([line([null, null])]);
  expect(screen.getByText(/No observed samples/)).toBeTruthy();
  unknown.unmount();
  const zero = mount([line([0, 0])]);
  expect(screen.queryByText(/No observed samples/)).toBeNull();
  expect(zero.container.querySelector(".MuiLineChart-line")).toBeNull();
  expect(screen.getByText("1 zero-only series hidden.").title).toContain("Custom selections are unchanged");
  expect(within(screen.getByLabelText("Signals legend")).queryByText("Series alpha")).toBeNull();
});
it("filters before coarse bucketing and preserves positive-earlier series", () => {
  const { container } = render(<SignalTrendsChart title="Coarse" lines={[line([0, 0], "zero"), line([1, 0], "earlier")]} from={from} to="2026-01-01T02:00:00Z" hours={24} />);
  expect(container.querySelectorAll(".MuiLineChart-line")).toHaveLength(1);
  expect(within(screen.getByLabelText("Coarse legend")).getByText("Series earlier")).toBeTruthy();
  expect(within(screen.getByLabelText("Coarse legend")).queryByText("Series zero")).toBeNull();
});
it("preserves the fixed three severity lines and labels at zero", () => {
  const lines = (["high", "medium", "low"] as const).map(metric => ({ key: metric, label: metric, metric, points: points([0, 0]).map(point => ({ ...point, counts: { high: 0, medium: 0, low: 0, changes: 0 } })) }));
  const { container } = render(<SignalTrendsChart title="Severity" preserveZero lines={lines} from={from} to="2026-01-01T02:00:00Z" hours={1} />);
  expect(container.querySelectorAll(".MuiLineChart-line")).toHaveLength(3);
  for (const label of ["high", "medium", "low"]) expect(within(screen.getByLabelText("Severity legend")).getByText(label)).toBeTruthy();
  expect(screen.queryByText(/zero-only series hidden/)).toBeNull();
});

it("stacks three severity areas cumulatively with stable risk colors and gaps", () => {
  const lines = (["high", "medium", "low"] as const).map((metric, i) => ({ key: metric, label: ["High", "Medium", "Low"][i], color: ["#d94b48", "#c69212", "#2688ce"][i], metric, points: points([1, 1, null, 1], "partial") }));
  const { container } = render(<SignalTrendsChart title="Severity" kind="stacked-area" preserveZero lines={lines} from={from} to="2026-01-01T04:00:00Z" hours={1} />);
  const areas = [...container.querySelectorAll(".MuiLineChart-area")];
  expect(areas).toHaveLength(3);
  const paths = [...container.querySelectorAll(".MuiLineChart-line")];
  const ys = paths.map(path => Number(/^M[^,]+,([\d.]+)/.exec(path.getAttribute("d")!)![1]));
  // Shared scale: top boundaries represent 1, 1+2 and 1+2+3, not 1,2,3.
  expect((ys[1] - ys[2]) / (ys[0] - ys[1])).toBeCloseTo(3 / 2, 2);
  paths.forEach((path, i) => {
    expect(path.getAttribute("stroke")).toBe(lines[i].color);
    expect(path.getAttribute("d")!.match(/M/g)).toHaveLength(2);
    expect(path.getAttribute("d")).not.toMatch(/NaN|[CQ]/);
  });
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  const tooltip = screen.getByRole("tooltip");
  for (const value of ["1 signal", "2 signals", "3 signals"]) expect(within(tooltip).getByText(value)).toBeTruthy();
  expect(tooltip.textContent).not.toMatch(/Partial|Last known/);
  fireEvent.keyDown(chart, { key: "ArrowRight" }); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getAllByText("No data")).toHaveLength(3);
});
it("does not turn a missing severity layer into a complete stack or visible zero", () => {
  const lines = [line([1, 1, 1], "High"), line([2, null, 2], "Medium"), line([3, 3, 3], "Low")];
  const { container } = render(<SignalTrendsChart title="Severity" kind="stacked-area" preserveZero lines={lines} from={from} to="2026-01-01T03:00:00Z" hours={1} />);
  for (const path of container.querySelectorAll(".MuiLineChart-line")) expect(path.getAttribute("d")!.match(/M/g)).toHaveLength(2);
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" }); fireEvent.keyDown(chart, { key: "ArrowRight" });
  const tooltip = screen.getByRole("tooltip");
  expect(within(tooltip).getByText("No data")).toBeTruthy();
  expect(within(tooltip).getByText("1 signal")).toBeTruthy();
  expect(within(tooltip).getByText("3 signals")).toBeTruthy();
  expect(tooltip.textContent).not.toMatch(/0 signals|Total/);
});
function changes(values: Array<number | null>, key: string): ChartLine {
  return { ...line(values, key), metric: "changes", points: points(values).map((point, i) => ({ ...point, confirmedChanges: values[i] ?? undefined, changesCoverage: values[i] === null ? "unknown" : "complete" })) };
}
it("stacks discrete change bars and exposes only positive rows through native keyboard and pointer tooltips", async () => {
  const lines = [changes([2, 0, null, 1], "alpha"), changes([3, 4, null, 0], "beta"), changes([0, 0, null, 0], "zero")];
  const { container } = render(<SignalTrendsChart title="Changes" kind="stacked-bar" lines={lines} from={from} to="2026-01-01T04:00:00Z" hours={1} />);
  expect(container.querySelector(".MuiLineChart-line")).toBeNull();
  const bars = [...container.querySelectorAll(".MuiBarChart-element")];
  expect(bars).toHaveLength(4);
  const firstBucket = bars.filter(bar => bar.getAttribute("x") === bars[0].getAttribute("x"));
  expect(firstBucket).toHaveLength(2);
  const [bottom, top] = firstBucket.map(bar => ({ y: Number(bar.getAttribute("y")), height: Number(bar.getAttribute("height")) }));
  expect(top.y + top.height).toBeCloseTo(bottom.y);
  expect(top.height / bottom.height).toBeCloseTo(3 / 2);
  expect(Number(bars[0].getAttribute("width"))).toBeGreaterThan(0);
  expect(within(screen.getByLabelText("Changes legend")).queryByText("Series zero")).toBeNull();
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  let tooltip = await screen.findByRole("tooltip");
  expect(within(tooltip).getByText("2 changes")).toBeTruthy();
  expect(within(tooltip).getByText("3 changes")).toBeTruthy();
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  tooltip = await screen.findByRole("tooltip");
  expect(within(tooltip).getByText("4 changes")).toBeTruthy();
  expect(tooltip.textContent).not.toMatch(/Series alpha|Series zero|0 changes|No data/);
  fireEvent.keyDown(chart, { key: "End" });
  expect((await screen.findByRole("tooltip")).textContent).toContain("1 change");
  const surface = container.querySelector(".MuiChartsSurface-root")!;
  fireEvent.pointerEnter(surface, { pointerType: "mouse", clientX: 100, clientY: 70 });
  fireEvent.pointerMove(surface, { pointerType: "mouse", clientX: 100, clientY: 70 });
  tooltip = await screen.findByRole("tooltip");
  expect(within(tooltip).getByText("2 changes")).toBeTruthy();
  expect(within(tooltip).getByText("3 changes")).toBeTruthy();
  fireEvent.pointerLeave(surface, { pointerType: "mouse", relatedTarget: document.body });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  fireEvent.keyDown(chart, { key: "Home" });
  expect((await screen.findByRole("tooltip")).textContent).toContain("2 changes");
});
it("sums confirmed changes in coarse bars independently of active counts and unknown remainder", () => {
  const data = changes([2, null, 3, null], "known");
  data.points = data.points.map(point => ({ ...point, counts: null, changesCoverage: "unknown" }));
  const { container } = render(<SignalTrendsChart title="Changes" kind="stacked-bar" lines={[data]} from={from} to="2026-01-01T04:00:00Z" hours={4} />);
  expect(container.querySelectorAll(".MuiBarChart-element")).toHaveLength(1);
  const chart = container.querySelector('[tabindex="0"]')!;
  fireEvent.focus(chart); fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(within(screen.getByRole("tooltip")).getByText("5 changes")).toBeTruthy();
  expect(screen.getByRole("tooltip").textContent).not.toMatch(/Total|Partial|0 changes/);
});
it.each([{ lines: [] }, { lines: [changes([0, 0], "zero")] }, { lines: [changes([null, null], "unknown")] }])("uses honest no-recorded-changes state without padding", ({ lines }) => {
  const { container } = render(<SignalTrendsChart title="Changes" kind="stacked-bar" lines={lines} from={from} to="2026-01-01T02:00:00Z" hours={1} />);
  expect(screen.getByText("No recorded changes.")).toBeTruthy();
  expect(screen.queryByText(/No activity|No selected retained series|zero-only/)).toBeNull();
  expect(container.querySelectorAll(".MuiBarChart-element")).toHaveLength(0);
});

it("bounds SVG nodes for 20 series across 90 days, including alternating isolated partial samples", () => {
  const values = Array.from({ length: 2160 }, (_, i) => i % 2 ? null : i % 7);
  const { container } = mount(Array.from({ length: 20 }, (_, i) => line(values, `series-${i}`, "partial")));
  expect(container.querySelectorAll(".MuiLineChart-line")).toHaveLength(20);
  expect(container.querySelectorAll('[data-observation="isolated"]')).toHaveLength(20);
  expect(container.querySelectorAll('[data-observation="partial"]')).toHaveLength(20);
  expect(container.querySelectorAll("svg *").length).toBeLessThan(500);
  expect(container.querySelectorAll("circle").length).toBeLessThanOrEqual(20);
});
