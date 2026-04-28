import { describe, expect, it } from "vitest";
import { formatEnvScalar } from "./envValues";

describe("formatEnvScalar", () => {
  it("keeps string values exactly as provided", () => {
    expect(formatEnvScalar("123456618273")).toBe("123456618273");
    expect(formatEnvScalar("1.1234e+4")).toBe("1.1234e+4");
  });

  it("formats numeric runtime values without scientific notation", () => {
    expect(formatEnvScalar(123456618273)).toBe("123456618273");
    expect(formatEnvScalar(1.1234e4)).toBe("11234");
    expect(formatEnvScalar(0.000001)).toBe("0.000001");
  });

  it("returns dash for absent values", () => {
    expect(formatEnvScalar(undefined)).toBe("-");
    expect(formatEnvScalar(null)).toBe("-");
    expect(formatEnvScalar("")).toBe("-");
  });
});

