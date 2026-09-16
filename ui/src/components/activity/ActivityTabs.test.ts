import { describe, expect, it } from "vitest";
import {
  formatNamespaceSweepDetail,
  namespaceSweepColor,
  namespaceSweepEvidenceLabels,
  type NamespaceSweepCoverage,
} from "./ActivityTabs";

const coverage: NamespaceSweepCoverage = {
  cluster: "ctx-large",
  enabled: true,
  totalNamespaces: 555,
  cachedEnrichmentNamespaces: 552,
  noCachedEnrichmentNamespaces: 3,
  cachedHotNamespaces: 500,
  cachedWarmNamespaces: 30,
  cachedColdNamespaces: 15,
  cachedStaleNamespaces: 5,
  cachedUnknownNamespaces: 2,
  enrichedNamespaces: 3,
  staleNamespaces: 1,
  neverScannedNamespaces: 552,
  systemNamespacesSkipped: 0,
  inFlight: true,
};

describe("ActivityTabs namespace sweep presentation", () => {
  it("presents cache coverage before explicit current-runtime history", () => {
    expect(namespaceSweepEvidenceLabels(coverage)).toEqual([
      "552/555 cached",
      "3 no cached summary",
      "500 hot",
      "30 warm",
      "15 cold",
      "5 stale",
      "2 unknown",
      "3 swept this runtime",
      "1 due for re-sweep",
      "552 no runtime sweep record",
    ]);

    const tooltip = formatNamespaceSweepDetail(coverage);
    expect(tooltip).toContain("cached summaries=552/555");
    expect(tooltip).toContain("no cached summary=3");
    expect(tooltip).toContain("swept this runtime=3");
    expect(tooltip).toContain("no runtime sweep record=552");
    expect(tooltip).not.toContain("never eligible");
  });

  it("warns for absent cached summaries, not absent runtime history", () => {
    expect(namespaceSweepColor(coverage)).toBe("warning");
    expect(namespaceSweepColor({
      ...coverage,
      inFlight: false,
      noCachedEnrichmentNamespaces: 0,
      cachedEnrichmentNamespaces: 555,
      neverScannedNamespaces: 555,
    })).toBe("info");
  });
});
