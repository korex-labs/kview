import { describe, it, expect } from "vitest";
import { fmtTs, valueOrDash, fmtAge } from "./format";

describe("format", () => {
  describe("fmtTs", () => {
    it("returns dash for null/undefined", () => {
      expect(fmtTs(null)).toBe("-");
      expect(fmtTs(undefined)).toBe("-");
    });
    it("formats unix timestamp as date string", () => {
      // 2025-01-15 12:00:00 UTC
      expect(fmtTs(1736935200)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("valueOrDash", () => {
    it("returns dash for undefined, null, empty string", () => {
      expect(valueOrDash(undefined)).toBe("-");
      expect(valueOrDash(null)).toBe("-");
      expect(valueOrDash("")).toBe("-");
    });
    it("returns string of value for number or string", () => {
      expect(valueOrDash(0)).toBe("0");
      expect(valueOrDash("hello")).toBe("hello");
    });
  });

  describe("fmtAge", () => {
    it("returns dash for invalid or negative", () => {
      expect(fmtAge(undefined)).toBe("-");
      expect(fmtAge(-1)).toBe("-");
      expect(fmtAge(NaN, "table")).toBe("-");
    });
    it("formats table style (d/h/m)", () => {
      expect(fmtAge(90, "table")).toBe("1m");
      expect(fmtAge(3661, "table")).toBe("1h 1m");
      expect(fmtAge(90061, "table")).toBe("1d 1h");
    });
    it("formats detail style", () => {
      expect(fmtAge(45)).toBe("45s");
      expect(fmtAge(120)).toBe("2m");
      expect(fmtAge(7200)).toBe("2h");
      expect(fmtAge(172800)).toBe("2d");
    });
  });
});
