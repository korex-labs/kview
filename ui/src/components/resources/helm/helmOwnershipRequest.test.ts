import { describe, expect, it } from "vitest";
import { acceptsHelmOwnershipResponse, helmReleaseSessionKey } from "./helmOwnershipRequest";

describe("Helm ownership request boundaries", () => {
  it("keys cancellation/remount by every context, credential and release dimension", () => {
    const original = ["cluster", "token", "namespace", "release", true, "healthy"] as const;
    const key = helmReleaseSessionKey(...original);
    const changed: Parameters<typeof helmReleaseSessionKey>[] = [
      ["other", "token", "namespace", "release", true, "healthy"],
      ["cluster", "rotated", "namespace", "release", true, "healthy"],
      ["cluster", "token", "other", "release", true, "healthy"],
      ["cluster", "token", "namespace", "other", true, "healthy"],
      ["cluster", "token", "namespace", null, true, "healthy"],
      ["cluster", "token", "namespace", "release", false, "healthy"],
      ["cluster", "token", "namespace", "release", true, "unhealthy"],
    ];
    expect(changed.every((args) => helmReleaseSessionKey(...args) !== key)).toBe(true);
    expect(helmReleaseSessionKey(...original)).toBe(key);
  });

  it("rejects wrong-context and late responses even when the transport ignores cancellation", () => {
    const request = new AbortController();
    expect(acceptsHelmOwnershipResponse(request.signal, "cluster", "cluster")).toBe(true);
    expect(acceptsHelmOwnershipResponse(request.signal, "cluster", "other")).toBe(false);
    expect(acceptsHelmOwnershipResponse(request.signal, "", "")).toBe(false);
    request.abort();
    expect(acceptsHelmOwnershipResponse(request.signal, "cluster", "cluster")).toBe(false);
  });
});
