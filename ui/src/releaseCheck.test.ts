import { describe, expect, it } from "vitest";
import { isComparableReleaseVersion, isUpdateAvailable } from "./releaseCheck";

describe("release version checks", () => {
  it("detects a newer patch release", () => {
    expect(isUpdateAvailable("v1.2.3", "v1.2.4")).toBe(true);
  });

  it("does not report equal or older releases as updates", () => {
    expect(isUpdateAvailable("v1.2.3", "v1.2.3")).toBe(false);
    expect(isUpdateAvailable("v1.10.0", "v1.9.9")).toBe(false);
  });

  it("treats stable releases as newer than matching prereleases", () => {
    expect(isUpdateAvailable("v1.2.3-rc.1", "v1.2.3")).toBe(true);
    expect(isUpdateAvailable("v1.2.3", "v1.2.3-rc.1")).toBe(false);
  });

  it("ignores dev builds, hashes, and malformed latest tags", () => {
    expect(isComparableReleaseVersion("dev")).toBe(false);
    expect(isComparableReleaseVersion("abc123def456")).toBe(false);
    expect(isUpdateAvailable("dev", "v1.2.4")).toBe(false);
    expect(isUpdateAvailable("abc123def456", "v1.2.4")).toBe(false);
    expect(isUpdateAvailable("v1.2.3", "latest")).toBe(false);
  });
});
