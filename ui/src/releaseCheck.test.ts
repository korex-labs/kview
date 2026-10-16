import { afterEach, describe, expect, it, vi } from "vitest";
import { getLatestReleaseWithCache, isComparableReleaseVersion, isUpdateAvailable } from "./releaseCheck";

afterEach(() => vi.unstubAllGlobals());
describe("release version checks", () => {
  it("fetches through the authenticated local API, without statistics or cluster context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tag_name: "v5.2.1", html_url: "https://github.com/korex-labs/kview/releases/tag/v5.2.1",
    }) });
    vi.stubGlobal("fetch", fetchMock);
    await getLatestReleaseWithCache(undefined, "local-secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/releases/latest", expect.objectContaining({
      headers: { Accept: "application/json", Authorization: "Bearer local-secret" },
    }));
  });
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
