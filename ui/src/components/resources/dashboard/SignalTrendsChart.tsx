import React, { useEffect, useId, useMemo, useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { LineChart, type LineChartProps } from "@mui/x-charts/LineChart";
import { BarChart } from "@mui/x-charts/BarChart";
import { useChartRootRef, useChartsLayerContainerRef, useXScale, useYScale } from "@mui/x-charts/hooks";
import { getChartPoint, useChartsContext, type LineChartPluginSignatures } from "@mui/x-charts/internals";
import { formatTrendLegendValue, trendLegendColorIndex, trendLegendStats } from "./signalTrendsLegend";
import { isZeroTrendLine, trendValue, type ChartLine, type TrendPoint } from "./signalTrends";

function metricCoverage(point: TrendPoint, metric: ChartLine["metric"]) {
  return (metric === "changes" ? point.changesCoverage : point.coverage) || "unknown";
}
function bucketCoverage(points: TrendPoint[], key: "coverage" | "changesCoverage") {
  return points.some(p => (key === "coverage" ? !p.counts : trendValue(p, "changes") === null) || !p[key] || p[key] === "unknown") ? "unknown" : points.some(p => p[key] === "partial") ? "partial" : "complete";
}
export function chartBuckets(points: TrendPoint[], hours: number, _metric: ChartLine["metric"] = "high"): TrendPoint[] {
  if (hours === 1) return points;
  const out: TrendPoint[] = [];
  for (let i = 0; i < points.length; i += hours) {
    const bucket = points.slice(i, i + hours), last = bucket[bucket.length - 1];
    const observed = bucket.filter(p => p.counts !== null);
    const evidence = observed[observed.length - 1];
    const confirmed = bucket.map(p => trendValue(p, "changes")).filter((n): n is number => n !== null);
    const confirmedChanges = confirmed.length ? confirmed.reduce((sum, n) => sum + n, 0) : undefined;
    const changed = bucket.filter(p => trendValue(p, "changes") !== null);
    const provenance = evidence || changed[changed.length - 1];
    const counts = evidence ? { ...evidence.counts!, changes: confirmedChanges ?? 0 } : null;
    const ages = bucket.map(p => p.sourceAgeSeconds).filter((n): n is number => typeof n === "number");
    out.push({ ...last, ...(provenance ? { sampleAt: provenance.sampleAt, sourceAt: provenance.sourceAt } : {}),
      carriedForward: bucket.some(p => p.carriedForward),
      freshness: bucket.some(p => p.freshness === "stale") ? "stale" : bucket.some(p => !p.freshness || p.freshness === "unknown") ? "unknown" : "fresh",
      sourceAgeSeconds: ages.length ? Math.max(...ages) : null, confirmedChanges,
      coverage: bucketCoverage(bucket, "coverage"), changesCoverage: bucketCoverage(bucket, "changesCoverage"),
      at: bucket[0].at, counts, reason: [...new Set(bucket.map(p => p.reason).filter(Boolean))].join("; ") });
  }
  return out;
}

const seriesToken = (key: string) => Array.from(key, char => char.codePointAt(0)!.toString(16)).join("-");
const utcTime = (value: string | number | Date) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
function observation(point: TrendPoint | undefined, metric: ChartLine["metric"]): string {
  const value = trendValue(point, metric);
  if (!point || value === null) return "No data";
  const unit = metric === "changes" ? (value === 1 ? "change" : "changes") : (value === 1 ? "signal" : "signals");
  return `${value.toLocaleString()} ${unit}`;
}
type PlottedLine = ChartLine & { color: string };

// Use library scales, not a second coordinate system. Batch sparse samples and
// incomplete-coverage diamonds and carried marks into bounded paths, not per-sample nodes.
function ObservationMarks({ lines, stacked = false, highlightedKey, chartId }: { lines: PlottedLine[]; stacked?: boolean; highlightedKey: string | null; chartId: string }) {
  const x = useXScale(), y = useYScale();
  const rootRef = useChartRootRef(), surfaceRef = useChartsLayerContainerRef();
  const { instance } = useChartsContext<LineChartPluginSignatures>();
  const geometry = useMemo(() => {
    const hits: Array<{ x: number; y: number; isolated: boolean; partial: boolean }> = [];
    const paths = lines.map((line, lineIndex) => {
      let isolated = "", partial = "", carried = "";
      line.points.forEach((point, index) => {
        const value = trendValue(point, line.metric);
        if (value === null || (stacked && lines.some(layer => trendValue(layer.points[index], layer.metric) === null))) return;
        const preceding = stacked ? lines.slice(0, lineIndex).map(previous => trendValue(previous.points[index], previous.metric)) : [];
        if (preceding.some(value => value === null)) return;
        const px = x(new Date(point.at)), py = y(preceding.reduce<number>((sum, value) => sum + (value ?? 0), value));
        if (px === undefined || py === undefined) return;
        const missing = (index: number) => stacked ? lines.some(layer => trendValue(layer.points[index], layer.metric) === null) : trendValue(line.points[index], line.metric) === null;
        const isIsolated = missing(index - 1) && missing(index + 1);
        const isPartial = metricCoverage(point, line.metric) !== "complete";
        if (isIsolated) isolated += `M${px},${py}l0,0`;
        if (line.metric !== "changes" && (point.carriedForward || point.freshness === "stale")) carried += `M${px - 2},${py}h4`;
        if (isPartial) partial += `M${px},${py - 3}l3,3 -3,3 -3,-3Z`;
        if (isIsolated || isPartial) hits.push({ x: px, y: py, isolated: isIsolated, partial: isPartial });
      });
      return <g key={line.key} id={`${chartId}-marks-${seriesToken(line.key)}`} data-observation-series={line.key} opacity={highlightedKey !== null && highlightedKey !== line.key ? 0.15 : 1}>
        {isolated && <path data-observation="isolated" d={isolated} stroke={line.color} strokeWidth={5} strokeLinecap="round" fill="none" />}
        {carried && <path data-observation="carried" d={carried} stroke={line.color} strokeWidth={4} opacity={0.45} fill="none" />}
        {partial && <path data-observation="partial" d={partial} stroke={line.color} strokeWidth={1.3} fill="none" />}
      </g>;
    });
    return { paths, hits: hits.sort((a, b) => a.x - b.x) };
  }, [lines, stacked, x, y, highlightedKey, chartId]);
  useEffect(() => {
    const root = rootRef.current, surface = surfaceRef.current;
    if (!root || !surface) return;
    // MUI's surface gesture resolves the nearest x cell first. At the root's
    // bubbling phase, refine only actual marker hits in that same interaction
    // store. No controlled axis or mirrored keyboard/tooltip state is needed.
    const move = (gesture: Event) => {
      const event = (gesture as CustomEvent<{ srcEvent: PointerEvent }>).detail.srcEvent;
      if (!surface.contains(event.target as Node)) return;
      const pointer = getChartPoint(surface, event);

      const hits = geometry.hits, radius = 4;
      let low = 0, high = hits.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (hits[middle].x < pointer.x - radius) low = middle + 1; else high = middle;
      }
      let nearest: typeof hits[number] | undefined, distance = Infinity;
      for (let i = low; i < hits.length && hits[i].x <= pointer.x + radius; i++) {
        const hit = hits[i], dx = Math.abs(hit.x - pointer.x), dy = Math.abs(hit.y - pointer.y), d = Math.hypot(dx, dy);
        if (((hit.isolated && d <= 2.5) || (hit.partial && dx + dy <= 3 + 1.3 / Math.SQRT2)) && d < distance) {
          nearest = hit; distance = d;
        }
      }
      if (nearest) instance.setPointerCoordinate({ x: nearest.x, y: pointer.y });
    };
    root.addEventListener("move", move);
    return () => root.removeEventListener("move", move);
  }, [geometry, instance, rootRef, surfaceRef]);
  return <g aria-hidden="true" pointerEvents="none">{geometry.paths}</g>;
}

// One header plus ten single-line rows, using the same metrics as the cells.
const legendVisibleRows = 10;
const legendLineHeight = 1.5;
const legendCellPaddingY = 0.25;

export type TrendChartKind = "line" | "stacked-area" | "stacked-bar";
export default function SignalTrendsChart({ title, lines, from, to, hours, preserveZero = false, kind = "line" }: { title: string; lines: ChartLine[]; from: string; to: string; hours: number; preserveZero?: boolean; kind?: TrendChartKind }) {
  const theme = useTheme();
  const chartId = useId();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [chartHighlight, setChartHighlight] = useState<{ seriesId: string } | null>(null);
  const hidden = useMemo(() => kind === "stacked-bar" ? lines.filter(line => !line.points.some(point => (trendValue(point, line.metric) ?? 0) > 0)) : preserveZero ? [] : lines.filter(isZeroTrendLine), [lines, preserveZero, kind]);
  const plotted = useMemo(() => {
    const colors = theme.palette.mode === "dark"
      ? ["#64b5f6", "#4db6ac", "#ffb74d", "#81c784", "#f48fb1", "#90a4ae", "#4dd0e1", "#dce775", "#ff8a65", "#a5d6a7"]
      : ["#1976d2", "#008577", "#a86300", "#38863c", "#b33970", "#526975", "#007f93", "#747b13", "#be5128", "#527536"];
    return lines.filter(line => line.points.length > 0 && !hidden.includes(line)).map(line => ({ ...line, color: line.color || colors[trendLegendColorIndex(line.key, colors.length)], points: chartBuckets(line.points, hours, line.metric) }));
  }, [lines, hidden, hours, theme.palette.mode]);
  // Removed rows do not reliably emit mouseleave/blur. Forget their selection
  // before it can revive if a later response reintroduces the same series.
  if (hoveredKey !== null && !plotted.some(line => line.key === hoveredKey)) setHoveredKey(null);
  if (focusedKey !== null && !plotted.some(line => line.key === focusedKey)) setFocusedKey(null);
  if (chartHighlight !== null && !plotted.some(line => line.key === chartHighlight.seriesId)) setChartHighlight(null);
  const candidateKey = hoveredKey ?? focusedKey ?? chartHighlight?.seriesId ?? null;
  const highlightedKey = plotted.some(line => line.key === candidateKey) ? candidateKey : null;
  const highlightedItem = useMemo(() => highlightedKey === null ? null : { seriesId: highlightedKey }, [highlightedKey]);
  const legend = useMemo(() => plotted.map(line => ({ ...line, stats: trendLegendStats(line) })), [plotted]);
  // The validated wire contract aligns all series to the same hourly window.
  const timestamps = useMemo(() => plotted[0]?.points.map(point => new Date(point.at)) || [], [plotted]);
  const series = useMemo(() => plotted.map(line => ({
    id: line.key, label: line.label, color: line.color,
    highlightScope: { highlight: "series" as const, fade: "global" as const },
    data: line.points.map((point, index) => {
      const value = trendValue(point, line.metric);
      // A missing layer cannot be treated as zero in a severity total. Keep the
      // original evidence for the tooltip, but leave the entire stack gapped.
      if (kind === "stacked-area" && plotted.some(layer => trendValue(layer.points[index], layer.metric) === null)) return null;
      return kind === "stacked-bar" && (value === null || value <= 0) ? null : value;
    }),
    ...(kind !== "line" ? { stack: "signals", stackOrder: "none" as const, stackOffset: "none" as const } : {}),
    valueFormatter: (value: number | null, context: { dataIndex: number }) => kind === "stacked-bar" && (value === null || value <= 0) ? null : observation(line.points[context.dataIndex], line.metric),
  })), [plotted, kind]);
  const hasObservations = series.some(line => line.data.some(value => value !== null));
  const common: Pick<LineChartProps, "height" | "title" | "desc" | "yAxis" | "margin" | "grid" | "skipAnimation" | "hideLegend" | "sx"> = {
    height: 240,
    title: `${title} chart; UTC; unknown intervals are gaps`,
    desc: kind === "stacked-bar" ? "Confirmed changes per interval, stacked by series. Missing evidence is not zero; bars may be known subtotals. Use arrow keys to explore intervals."
      : "Use arrow keys to explore observations. Diamonds indicate incomplete coverage; isolated observations are dots. Short muted marks indicate last-known values. Unknown intervals are gaps; incomplete stacks are known subtotals, not complete totals.",
    yAxis: [{ min: 0, ...(!hasObservations ? { max: 1 } : {}), tickMinStep: 1, tickNumber: 4, width: 44, valueFormatter: (value: number) => Number.isInteger(value) ? value.toLocaleString() : "" }],
    margin: { top: 12, right: 16, bottom: 8, left: 4 },
    grid: { horizontal: true }, skipAnimation: true, hideLegend: true,
    sx: { "& [data-faded=true]": { opacity: 0.15 }, "& .MuiChartsGrid-line": { stroke: theme.palette.divider, strokeDasharray: "3 4" }, "& .MuiChartsAxis-line, & .MuiChartsAxis-tick": { stroke: theme.palette.divider }, "& .MuiChartsAxis-tickLabel": { fill: theme.palette.text.secondary }, "&:focus-within": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2, borderRadius: 1 } },
  };
  const timeAxis = { id: "time", data: timestamps, valueFormatter: (value: Date) => `${utcTime(value)} UTC`, tickLabelStyle: { fontSize: 10 } };
  const tooltip = { trigger: "axis" as const, sx: { maxWidth: "min(90vw, 680px)", "& td": { whiteSpace: "normal", overflowWrap: "anywhere" } } };
  return <Box sx={{ position: "relative", minWidth: 0, width: "100%" }}>
    {kind === "stacked-bar" ? <BarChart {...common} highlightedItem={highlightedItem} onHighlightChange={setChartHighlight} series={series}
      xAxis={[{ ...timeAxis, scaleType: "band", categoryGapRatio: 0.2, tickLabelInterval: (_value, index) => index % Math.max(1, Math.ceil(timestamps.length / 4)) === 0 }]}
      axisHighlight={{ x: "band", y: "none" }} slotProps={{ tooltip }}
    /> : <LineChart {...common} highlightedItem={highlightedItem} onHighlightChange={setChartHighlight}
      series={series.map(series => ({ ...series, area: kind === "stacked-area", curve: "linear", connectNulls: false, showMark: false }))}
      xAxis={[{ ...timeAxis, scaleType: "utc", min: new Date(from), max: new Date(to), tickNumber: 4 }]}
      axisHighlight={{ x: "line", y: "none" }}
      slotProps={{ tooltip, line: ({ seriesId, isHighlighted }) => ({ id: `${chartId}-line-${seriesToken(seriesId)}`, style: { strokeWidth: isHighlighted ? 4 : 2, strokeDasharray: plotted.findIndex(line => line.key === seriesId) >= 10 ? "6 3" : undefined } }) }}
    >
      <ObservationMarks lines={plotted} stacked={kind === "stacked-area"} highlightedKey={highlightedKey} chartId={chartId} />
      {/* Reuse the exact library geometry above peers, without reordering stacks or data. */}
      {highlightedKey !== null && <g data-highlight-overlay={highlightedKey} aria-hidden="true" pointerEvents="none">
        <use href={`#${chartId}-line-${seriesToken(highlightedKey)}`} />
        <use href={`#${chartId}-marks-${seriesToken(highlightedKey)}`} />
      </g>}
    </LineChart>}
    {kind === "stacked-bar" && !hasObservations ? <Typography variant="caption">No recorded changes.</Typography> : !lines.length && <Typography variant="caption">No selected retained series.</Typography>}
    {kind !== "stacked-bar" && hidden.length > 0 && <Typography variant="caption" color="text.secondary" title={`Hidden for this period: ${hidden.map(line => line.label).join(", ")}. All observed values of the plotted measure are zero with complete coverage; missing hours remain unknown. Custom selections are unchanged.`}>{hidden.length} zero-only series hidden.</Typography>}
    {kind !== "stacked-bar" && plotted.length > 0 && !hasObservations && <Typography variant="caption" color="text.secondary">No observed samples in this period — unknown is not zero.</Typography>}
    <Box className="kview-native-scrollbar" sx={{ fontSize: "0.75rem", lineHeight: legendLineHeight, maxHeight: `calc(${(legendVisibleRows + 1) * legendLineHeight}em + ${theme.spacing((legendVisibleRows + 1) * 2 * legendCellPaddingY)})`, overflow: "auto", mt: 0.5 }}>
      <Box component="table" aria-label={`${title} legend`} sx={{ width: "100%", borderCollapse: "collapse", fontSize: "inherit", lineHeight: "inherit", fontVariantNumeric: "tabular-nums", "& th, & td": { px: 0.75, py: legendCellPaddingY, textAlign: "right", whiteSpace: "nowrap" }, "& th:first-of-type": { textAlign: "left" } }}>
        <Box component="thead" sx={{ position: "sticky", top: 0, bgcolor: "background.paper", zIndex: 1, color: "text.secondary" }}>
          <tr><th scope="col">Series</th>{["Min", "Avg", "Max", "Last"].map(label => <th key={label} scope="col">{label}</th>)}</tr>
        </Box>
        <tbody>{legend.map((line, i) => <Box component="tr" key={line.key} tabIndex={0} aria-label={line.label} data-legend-series={line.key}
          onMouseEnter={() => setHoveredKey(line.key)} onMouseLeave={() => setHoveredKey(null)}
          onFocus={() => setFocusedKey(line.key)} onBlur={() => setFocusedKey(null)}
          sx={{ bgcolor: highlightedKey === line.key ? "action.selected" : undefined, color: "text.primary", opacity: highlightedKey !== null && highlightedKey !== line.key ? 0.55 : 1, "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 } }}>
          <th scope="row" title={line.label}><Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.75, fontWeight: highlightedKey === line.key ? 700 : 400 }}>
            <Box component="span" aria-hidden="true" sx={{ width: 18, flexShrink: 0, borderTop: `2px ${i >= 10 ? "dashed" : "solid"} ${line.color}` }} />
            <Box component="span" sx={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.label}</Box>
          </Box></th>
          {(["min", "avg", "max", "last"] as const).map(stat => <td key={stat}>{formatTrendLegendValue(line.stats[stat])}</td>)}
        </Box>)}</tbody>
      </Box>
    </Box>
  </Box>;
}
