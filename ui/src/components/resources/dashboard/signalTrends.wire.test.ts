import { describe, expect, it } from "vitest";
import fixtures from "./testdata/signalTrends.wire.json";
import { parseSignalTrends, trendLines, type TrendQuery } from "./signalTrends";

describe("real Go store JSON contract", () => {
  it.each(fixtures)("parses $name", ({ query, response }) => {
    expect(() => parseSignalTrends(structuredClone(response), query as TrendQuery)).not.toThrow();
  });
  it("retains positive confirmed changes and partial coverage in the Top Changes chart measure", () => {
    const fixture = fixtures.find(value => value.name === "partial-confirmed-changes")!;
    const data = parseSignalTrends(structuredClone(fixture.response), fixture.query as TrendQuery);
    for (const series of [data.rules, data.nodes, data.namespaces]) {
      expect(series[0].changesScore).toBe(1);
      const lines = trendLines(series, "topChanges10", "active");
      expect(lines[0].metric).toBe("changes");
      expect(lines[0].points[0]).toMatchObject({ confirmedChanges: 1, changesCoverage: "partial" });
    }
  });
});
