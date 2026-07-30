// @vitest-environment jsdom

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: "ctx-a",
  health: "healthy",
  requests: [] as Array<{
    resolve: (value: { capabilities: { delete: boolean; update: boolean; patch: boolean; create: boolean } }) => void;
    reject: (reason?: unknown) => void;
  }>,
}));

vi.mock("../../activeContext", () => ({ useActiveContext: () => mocks.context }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: mocks.health }) }));
vi.mock("../../api", () => ({
  apiPostWithContext: vi.fn(() => new Promise((resolve, reject) => {
    mocks.requests.push({ resolve, reject });
  })),
}));

import { useResourceCapabilities } from "./useResourceCapabilities";

const denied = { delete: false, update: false, patch: false, create: false };
const allowed = { delete: true, update: true, patch: true, create: true };

beforeEach(() => {
  mocks.context = "ctx-a";
  mocks.health = "healthy";
  mocks.requests = [];
});

describe("useResourceCapabilities", () => {
  it("never exposes capabilities returned for a previous resource target", async () => {
    const { result, rerender } = renderHook(
      ({ name }) => useResourceCapabilities({
        token: "token",
        group: "apps",
        resource: "deployments",
        namespace: "apps",
        name,
      }),
      { initialProps: { name: "deployment-a" } },
    );

    await waitFor(() => expect(mocks.requests).toHaveLength(1));
    rerender({ name: "deployment-b" });
    expect(result.current).toBeNull();
    await waitFor(() => expect(mocks.requests).toHaveLength(2));

    await act(async () => mocks.requests[0].resolve({ capabilities: allowed }));
    expect(result.current).toBeNull();

    await act(async () => mocks.requests[1].resolve({ capabilities: denied }));
    await waitFor(() => expect(result.current).toEqual(denied));
  });
});
