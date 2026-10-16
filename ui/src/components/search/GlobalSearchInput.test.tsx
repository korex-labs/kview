// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GlobalSearchInput, { ResourceOption, SnapshotOption } from "./GlobalSearchInput";
import { apiGetWithContext } from "../../api";
import { listInvestigationSnapshots } from "../../investigationSnapshots";

vi.mock("../../api", () => ({
  apiGet: vi.fn(),
  apiGetWithContext: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../../investigationSnapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../investigationSnapshots")>();
  return {
    ...actual,
    listInvestigationSnapshots: vi.fn(),
  };
});

const mockedApiGetWithContext = vi.mocked(apiGetWithContext);
const mockedListInvestigationSnapshots = vi.mocked(listInvestigationSnapshots);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockedApiGetWithContext.mockReset();
  mockedListInvestigationSnapshots.mockReset();
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
    mockedListInvestigationSnapshots.mockResolvedValue([]);

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

  it("shows saved investigation snapshots and opens their primary resource", async () => {
    const onOpenResource = vi.fn();
    const snapshot = {
      id: "snap-1",
      context: "kind-dev",
      title: "Investigation: CrashLoopBackOff on pods api-7f",
      triageState: "known" as const,
      signal: { type: "pod_crash_loop_waiting", title: "CrashLoopBackOff", severity: "high" },
      primaryResource: { kind: "pods", namespace: "app-prod", name: "api-7f" },
      markdown: "# Investigation",
      operatorNote: "Known deploy regression.",
      source: "investigate-signal",
    };
    mockedApiGetWithContext.mockResolvedValue({ active: "kind-dev", query: "regression", limit: 10, offset: 0, hasMore: false, items: [] });
    mockedListInvestigationSnapshots.mockResolvedValue([snapshot]);

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
    fireEvent.change(screen.getByPlaceholderText("Search or command"), { target: { value: "regression" } });

    const resultName = await screen.findByText("Investigation: CrashLoopBackOff on pods api-7f");
    fireEvent.mouseDown(resultName);

    await waitFor(() => expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({
      cluster: "kind-dev",
      kind: "pods",
      namespace: "app-prod",
      name: "api-7f",
    })));
  });
});

describe("SnapshotOption", () => {
  it("renders saved investigation snapshot context", () => {
    render(
      <SnapshotOption
        item={{
          matchReason: "note",
          snapshot: {
            id: "snap-1",
            context: "kind-dev",
            title: "Investigation: CrashLoopBackOff on pods api-7f",
            triageState: "known",
            signal: { type: "pod_crash_loop_waiting", severity: "high" },
            primaryResource: { kind: "pods", namespace: "app-prod", name: "api-7f" },
            markdown: "# Investigation",
            operatorNote: "Known deploy regression.",
            source: "investigate-signal",
          },
        }}
      />,
    );

    expect(screen.getByText("Investigation: CrashLoopBackOff on pods api-7f")).toBeTruthy();
    expect(screen.getByText("snapshot")).toBeTruthy();
    expect(screen.getByText("note match")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("known")).toBeTruthy();
    expect(screen.getByText("pods · app-prod/api-7f")).toBeTruthy();
    expect(screen.getByText("Known deploy regression.")).toBeTruthy();
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

describe("inline search, map options and namespace preference", () => {
  const apiItem = { cluster: "kind-dev", kind: "pods", namespace: "prod", name: "api-7f" };
  function props() {
    return { token: "token", activeContext: "kind-dev", namespaces: ["prod"], contexts: ["kind-dev", "other"],
      onSelectSection: vi.fn(), onSelectNamespace: vi.fn(), onSelectContext: vi.fn(), onOpenResource: vi.fn(), onOpenResourceMap: vi.fn(), onOpenSettings: vi.fn() };
  }
  function setup() {
    vi.useFakeTimers();
    mockedListInvestigationSnapshots.mockResolvedValue([]);
    mockedApiGetWithContext.mockResolvedValue({ items: [apiItem], hasMore: false });
  }
  async function search(query = "api-7f") {
    const input = screen.getByPlaceholderText("Search or command") as HTMLInputElement;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: query } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    return input;
  }
  function held() {
    let resolve!: (value: { items: typeof apiItem[]; hasMore: boolean }) => void;
    const promise = new Promise<{ items: typeof apiItem[]; hasMore: boolean }>((done) => { resolve = done; });
    return { promise, resolve };
  }

  it("keeps ordinary Enter on details and offers keyboard Map inside the listbox", async () => {
    setup();
    const handlers = props();
    render(<GlobalSearchInput {...handlers} />);
    const input = await search();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onOpenResource).toHaveBeenCalledExactlyOnceWith(apiItem);
    expect(handlers.onOpenResourceMap).not.toHaveBeenCalled();
    await search();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const map = screen.getByRole("option", { name: /^Map api-7f/ });
    expect(screen.getByRole("listbox").contains(map)).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBe(map.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onOpenResourceMap).toHaveBeenCalledExactlyOnceWith(apiItem);
    expect(screen.queryByText(/Map selected resource/)).toBeNull();
  });

  it("maps a mouse-selected option without opening details", async () => {
    setup();
    const handlers = props();
    render(<GlobalSearchInput {...handlers} />);
    await search();
    fireEvent.mouseDown(screen.getByRole("option", { name: /^Map api-7f/ }));
    expect(handlers.onOpenResourceMap).toHaveBeenCalledExactlyOnceWith(apiItem);
    expect(handlers.onOpenResource).not.toHaveBeenCalled();
  });

  it("maps the second resource with its exact identity via keyboard", async () => {
    setup();
    const second = { ...apiItem, namespace: "other", name: "api-second" };
    mockedApiGetWithContext.mockResolvedValue({ items: [apiItem, second], hasMore: false });
    const handlers = props();
    render(<GlobalSearchInput {...handlers} />);
    const input = await search();
    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /^Map api-second/ }).id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onOpenResourceMap).toHaveBeenCalledExactlyOnceWith(second);
    expect(handlers.onOpenResource).not.toHaveBeenCalled();
  });

  it("hides a previously loaded Map target immediately on namespace changes", async () => {
    setup();
    const handlers = props();
    const view = render(<GlobalSearchInput {...handlers} activeNamespace="prod" activeScope="namespaced" />);
    await search();
    expect(screen.getByRole("option", { name: /^Map api-7f/ })).toBeTruthy();
    const pending = held();
    mockedApiGetWithContext.mockReturnValue(pending.promise);
    view.rerender(<GlobalSearchInput {...handlers} activeNamespace="other" activeScope="namespaced" />);
    expect(screen.queryByRole("option", { name: /^Map api-7f/ })).toBeNull();
    expect(handlers.onOpenResourceMap).not.toHaveBeenCalled();
  });

  it("clears chips and an uncommitted filter on Escape without blur restoring them", async () => {
    setup();
    render(<GlobalSearchInput {...props()} />);
    const input = await search("ns:prod kind:ingress");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.queryByLabelText("Search filters")).toBeNull();
  });

  it("does not split continuous kind:pods typing at the valid kind:pod prefix", async () => {
    setup();
    render(<GlobalSearchInput {...props()} />);
    const input = await search("kind:pod");
    expect(screen.queryByLabelText("Remove filter kind:pod")).toBeNull();
    fireEvent.change(input, { target: { value: "kind:pods" } });
    expect(input.value).toBe("kind:pods");
    fireEvent.change(input, { target: { value: "kind:pods " } });
    expect(input.value).toBe(" ");
    expect(screen.getByLabelText("Remove filter kind:pods")).toBeTruthy();
    fireEvent.change(input, { target: { value: " api" } });
    expect(input.value).toBe(" api");
    expect(screen.queryByLabelText("Remove filter kind:pod")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    const path = String(mockedApiGetWithContext.mock.calls[mockedApiGetWithContext.mock.calls.length - 1]?.[0]);
    expect(new URL(path, "http://test").searchParams.get("q")).toBe("kind:pods  api");
  });

  it("commits final ingress on blur and keeps chips inside a fixed-height single line", async () => {
    setup();
    render(<GlobalSearchInput {...props()} />);
    const input = await search("kind:ingress");
    act(() => input.blur());
    expect(input.value).toBe("");
    const chip = screen.getByLabelText("Remove filter kind:ingress");
    const root = input.closest(".MuiOutlinedInput-root")!;
    expect(root.contains(chip)).toBe(true);
    expect(getComputedStyle(root).height).toBe("40px");
    expect(getComputedStyle(root).flexWrap).toBe("nowrap");
    const strip = screen.getByLabelText("Search filters");
    expect(getComputedStyle(strip).overflowX).toBe("auto");
    expect(getComputedStyle(strip).maxWidth).toBe("65%");
    fireEvent.keyUp(chip, { key: "Backspace" });
    expect(screen.queryByLabelText("Search filters")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("retains quoted spelling, invalid literals and raw draft whitespace when removing chips", async () => {
    setup();
    render(<GlobalSearchInput {...props()} />);
    const input = await search('api  status:"Not Ready" ns:prod kind:bogus ');
    expect(input.value).toBe('api    kind:bogus ');
    expect(screen.getByLabelText('Remove filter status:"Not Ready"')).toBeTruthy();
    fireEvent.keyUp(screen.getByLabelText("Remove filter ns:prod"), { key: "Backspace" });
    expect(input.value).toBe('api    kind:bogus ');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByLabelText("Remove filter kind:bogus")).toBeNull();
  });

  it.each(["local", "broad"])("starts both partitions in one debounce and orders local first when %s resolves first", async (first) => {
    setup();
    const local = held(); const broad = held();
    mockedApiGetWithContext.mockImplementation((path) => String(path).includes("&namespace=") ? local.promise : broad.promise);
    render(<GlobalSearchInput {...props()} activeNamespace="prod" activeScope="namespaced" />);
    await search();
    expect(mockedApiGetWithContext).toHaveBeenCalledTimes(2);
    expect(mockedApiGetWithContext.mock.calls.map(([path]) => String(path))).toEqual([
      expect.stringContaining("&offset=0&namespace=prod"), expect.stringContaining("&offset=0&excludeNamespace=prod"),
    ]);
    const remote = { ...apiItem, namespace: "elsewhere", name: "api-remote" };
    if (first === "local") {
      await act(async () => local.resolve({ items: [apiItem], hasMore: false }));
      expect(screen.getByText("api-7f")).toBeTruthy();
      expect(screen.queryByText("api-remote")).toBeNull();
      await act(async () => broad.resolve({ items: [remote], hasMore: false }));
    } else {
      await act(async () => broad.resolve({ items: [remote], hasMore: false }));
      expect(screen.queryByText("api-remote")).toBeNull();
      await act(async () => local.resolve({ items: [apiItem], hasMore: false }));
    }
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toContain("api-7f");
    expect(options[2].textContent).toContain("api-remote");
  });

  it("pages each partition independently and deduplicates identities without corrupting offsets", async () => {
    setup();
    const remote = { ...apiItem, namespace: "elsewhere", name: "api-remote" };
    mockedApiGetWithContext.mockResolvedValueOnce({ items: [apiItem], hasMore: true })
      .mockResolvedValueOnce({ items: [remote], hasMore: true });
    render(<GlobalSearchInput {...props()} activeNamespace="prod" activeScope="namespaced" />);
    await search();
    mockedApiGetWithContext.mockResolvedValueOnce({ items: [apiItem, { ...apiItem, name: "api-second" }], hasMore: false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more cached resources" })));
    expect(mockedApiGetWithContext.mock.calls[mockedApiGetWithContext.mock.calls.length - 1]?.[0]).toContain("offset=1&namespace=prod");
    expect(screen.getAllByText("api-7f")).toHaveLength(1);
    mockedApiGetWithContext.mockResolvedValueOnce({ items: [remote], hasMore: false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more cached resources" })));
    expect(mockedApiGetWithContext.mock.calls[mockedApiGetWithContext.mock.calls.length - 1]?.[0]).toContain("offset=1&excludeNamespace=prod");
    expect(screen.getAllByText("api-remote")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more cached resources" })).toBeNull();
  });

  it.each(["ns:other", "namespace:other", "cluster-scope", "empty-namespace"])("bypasses preference for %s", async (mode) => {
    setup();
    render(<GlobalSearchInput {...props()} activeNamespace={mode === "empty-namespace" ? "" : "prod"}
      activeScope={mode === "cluster-scope" ? "cluster" : "namespaced"} />);
    await search(mode.includes(":") ? mode : "api");
    expect(mockedApiGetWithContext).toHaveBeenCalledTimes(1);
    expect(mockedApiGetWithContext.mock.calls[0][0]).not.toMatch(/&(?:namespace|excludeNamespace)=/);
  });

  it.each(["token", "context", "namespace", "scope", "query", "disabled"])("cancels both partitions and rejects late results on %s changes", async (transition) => {
    setup();
    const local = held(); const broad = held();
    mockedApiGetWithContext.mockReturnValueOnce(local.promise).mockReturnValueOnce(broad.promise);
    const handlers = props();
    const view = render(<GlobalSearchInput {...handlers} activeNamespace="prod" activeScope="namespaced" />);
    const input = await search();
    const signals = mockedApiGetWithContext.mock.calls.map((call) => call[3]?.signal);
    if (transition === "query") fireEvent.change(input, { target: { value: "changed" } });
    else view.rerender(<GlobalSearchInput {...handlers}
      token={transition === "token" ? "next-token" : "token"}
      activeContext={transition === "context" ? "other" : "kind-dev"}
      activeNamespace={transition === "namespace" ? "next" : "prod"}
      activeScope={transition === "scope" ? "cluster" : "namespaced"}
      disabled={transition === "disabled"} />);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    await act(async () => {
      local.resolve({ items: [apiItem], hasMore: true });
      broad.resolve({ items: [{ ...apiItem, name: "stale" }], hasMore: false });
    });
    expect(screen.queryByText("api-7f")).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
    expect(screen.queryByRole("option", { name: /^Map/ })).toBeNull();
  });

  it("does not execute a draft-only command when filters are committed", async () => {
    setup();
    mockedApiGetWithContext.mockResolvedValue({ items: [], hasMore: false });
    const handlers = props();
    render(<GlobalSearchInput {...handlers} />);
    const input = await search("kind:pod ");
    fireEvent.change(input, { target: { value: "nodes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(handlers.onSelectSection).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Remove filter kind:pod")).toBeTruthy();
  });

  it("retains a partition failure after the other succeeds and clears it only on retry", async () => {
    setup();
    const broad = held();
    mockedApiGetWithContext.mockRejectedValueOnce(new Error("Local search failed"))
      .mockReturnValueOnce(broad.promise);
    render(<GlobalSearchInput {...props()} activeNamespace="prod" activeScope="namespaced" />);
    await search();
    expect(screen.getByRole("alert").textContent).toContain("Local search failed");
    await act(async () => broad.resolve({ items: [{ ...apiItem, namespace: "other", name: "api-remote" }], hasMore: false }));
    expect(screen.getByText("api-remote")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Local search failed");
    mockedApiGetWithContext.mockResolvedValueOnce({ items: [apiItem], hasMore: false });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry failed search" })));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("api-7f")).toBeTruthy();
    expect(screen.getByText("api-remote")).toBeTruthy();
  });

  it("paginates broad results despite repeated failures in the local partition", async () => {
    setup();
    const remote = { ...apiItem, namespace: "other", name: "api-remote" };
    mockedApiGetWithContext.mockImplementation((path) => {
      if (String(path).includes("&namespace=")) return Promise.reject(new Error("Local unavailable"));
      return Promise.resolve(String(path).includes("offset=0")
        ? { items: [remote], hasMore: true }
        : { items: [{ ...remote, name: "api-next" }], hasMore: false });
    });
    render(<GlobalSearchInput {...props()} activeNamespace="prod" activeScope="namespaced" />);
    await search();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry failed search" })));
    expect(screen.getByRole("alert").textContent).toContain("Local unavailable");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more cached resources" })));
    expect(mockedApiGetWithContext.mock.calls[mockedApiGetWithContext.mock.calls.length - 1][0]).toContain("offset=1&excludeNamespace=prod");
    expect(screen.getByText("api-next")).toBeTruthy();
    expect(screen.getByText("api-remote")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Local unavailable");
    expect(screen.queryByRole("button", { name: "Load more cached resources" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry failed search" })).toBeTruthy();
  });

  it("does not interpret command-mode filters or issue resource searches", async () => {
    setup();
    render(<GlobalSearchInput {...props()} />);
    await search(": name:api");
    expect(screen.queryByLabelText("Search filters")).toBeNull();
    expect(mockedApiGetWithContext).not.toHaveBeenCalled();
  });
});