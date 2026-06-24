// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GlobalSearchInput, { ResourceOption } from "./GlobalSearchInput";
import { apiGetWithContext } from "../../api";

vi.mock("../../api", () => ({
  apiGetWithContext: vi.fn(),
}));

const mockedApiGetWithContext = vi.mocked(apiGetWithContext);

afterEach(() => {
  cleanup();
  mockedApiGetWithContext.mockReset();
});

describe("GlobalSearchInput", () => {
  it("opens a cached resource when selected with the mouse", async () => {
    const onOpenResource = vi.fn();
    const apiItem = {
      cluster: "kind-dev",
      kind: "pods",
      namespace: "app-prod",
      name: "api-7f",
      healthBucket: "degraded",
      listStatus: "CrashLoopBackOff",
      signalSeverity: "high",
      signalCount: 2,
      needsAttention: true,
      matchReason: "namespace",
    };
    mockedApiGetWithContext.mockResolvedValue({
      active: "kind-dev",
      query: "api",
      limit: 10,
      offset: 0,
      hasMore: false,
      items: [apiItem],
    });

    render(
      <GlobalSearchInput
        token="token"
        activeContext="kind-dev"
        namespaces={["app-prod"]}
        contexts={["kind-dev"]}
        onSelectSection={vi.fn()}
        onSelectNamespace={vi.fn()}
        onSelectContext={vi.fn()}
        onOpenResource={onOpenResource}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Search or command"));
    fireEvent.change(screen.getByPlaceholderText("Search or command"), { target: { value: "api" } });

    const resultName = await screen.findByText("api-7f");
    fireEvent.mouseDown(resultName);

    await waitFor(() => expect(onOpenResource).toHaveBeenCalledWith(apiItem));
  });
});

describe("ResourceOption", () => {
  it("renders signal and health context for enriched cached search results", () => {
    render(
      <ResourceOption
        item={{
          cluster: "kind-dev",
          kind: "pods",
          namespace: "app-prod",
          name: "api-7f",
          healthBucket: "degraded",
          listStatus: "CrashLoopBackOff",
          signalSeverity: "high",
          signalCount: 2,
          needsAttention: true,
          matchReason: "namespace",
        }}
      />,
    );

    expect(screen.getByText("api-7f")).toBeTruthy();
    expect(screen.getByText("Pods")).toBeTruthy();
    expect(screen.getByText("namespace match")).toBeTruthy();
    expect(screen.getByText("ns: app-prod")).toBeTruthy();
    expect(screen.getByText("2 signals")).toBeTruthy();
    expect(screen.getByText("degraded")).toBeTruthy();
    expect(screen.getByText("CrashLoopBackOff")).toBeTruthy();
    expect(screen.getByText(/Pods · kind-dev \/ app-prod/)).toBeTruthy();
  });

  it("shows an attention chip when a result needs attention without a signal count", () => {
    render(
      <ResourceOption
        item={{
          cluster: "kind-dev",
          kind: "deployments",
          namespace: "app-prod",
          name: "api",
          needsAttention: true,
          signalSeverity: "medium",
        }}
      />,
    );

    expect(screen.getByText("attention")).toBeTruthy();
    expect(screen.getByText("Deployments")).toBeTruthy();
    expect(screen.getByText("cached match")).toBeTruthy();
  });
});
