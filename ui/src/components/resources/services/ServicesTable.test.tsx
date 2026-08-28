import { describe, expect, it } from "vitest";

import { formatServiceEndpointsSummary } from "./ServicesTable";

describe("formatServiceEndpointsSummary", () => {
  it("does not present unknown observation as zero endpoints", () => {
    expect(formatServiceEndpointsSummary("unknown", 0, 0)).toBe("Unknown coverage");
    expect(formatServiceEndpointsSummary(undefined, 0, 0)).toBe("Unknown coverage");
  });

  it("formats observed endpoint counts", () => {
    expect(formatServiceEndpointsSummary("complete", 3, 1)).toBe("3/4");
    expect(formatServiceEndpointsSummary("complete", 0, 0)).toBe("0/0");
  });
});