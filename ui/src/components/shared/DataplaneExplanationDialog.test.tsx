// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGetWithContext } from "../../api";
import type { ApiDataplaneExplanationResponse, DataplaneExplanationItem, DataplaneListMeta } from "../../types/api";
import DataplaneExplanationDialog from "./DataplaneExplanationDialog";
import { buildDataplaneListExplanationSurface } from "./dataplaneExplanationModel";

vi.mock("../../api", () => ({ apiGetWithContext: vi.fn() }));

const meta: DataplaneListMeta = {
  state: "hot",
  freshness: "hot",
  coverage: "full",
  degradation: "none",
  completeness: "complete",
  revision: "42",
};

function runtime(profile = "balanced"): DataplaneExplanationItem {
  return { loaded: true, profile, observers: [] };
}

function response(active = "kind-dev", profile = "balanced"): ApiDataplaneExplanationResponse {
  return { active, item: runtime(profile) };
}

function dialog(overrides: Partial<React.ComponentProps<typeof DataplaneExplanationDialog>> = {}) {
  return (
    <DataplaneExplanationDialog
      open={false}
      onClose={vi.fn()}
      token="token"
      activeContext="kind-dev"
      surface={buildDataplaneListExplanationSurface(meta)}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.mocked(apiGetWithContext).mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DataplaneExplanationDialog", () => {
  it("does not request runtime explanation while closed", () => {
    render(dialog());
    expect(apiGetWithContext).not.toHaveBeenCalled();
  });

  it("does not request without an active context and explains unavailability", () => {
    render(dialog({ open: true, activeContext: "  " }));
    expect(apiGetWithContext).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Runtime explanation unavailable: select an active context");
  });

  it("makes exactly one context-aware GET on first open", async () => {
    render(dialog({ open: true }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(1));
    expect(apiGetWithContext).toHaveBeenCalledWith(
      "/api/dataplane/explanation",
      "token",
      "kind-dev",
      { signal: expect.any(AbortSignal) },
    );
    expect(await screen.findByText("Balanced")).toBeTruthy();
  });

  it("shows truthful loading sections, then transitions to resolved not-loaded state", async () => {
    let resolveRuntime: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    vi.mocked(apiGetWithContext).mockImplementationOnce(() => new Promise((resolve) => { resolveRuntime = resolve; }));
    render(dialog({ open: true }));

    const loading = screen.getByRole("status", { name: "Loading runtime explanation" });
    expect(loading.getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByText("Loading")).toHaveLength(4);
    expect(screen.queryByText("Not loaded")).toBeNull();
    const snapshotHeading = screen.getByRole("heading", { name: "Snapshot" });
    const snapshotSection = screen.getByRole("region", { name: "Snapshot" });
    expect(snapshotHeading.id).not.toBe("");
    expect(snapshotSection.tagName).toBe("SECTION");
    expect(snapshotSection.getAttribute("aria-labelledby")).toBe(snapshotHeading.id);
    expect(snapshotHeading.tagName).toBe("H3");

    resolveRuntime?.({ active: "kind-dev", item: { loaded: false, profile: "", observers: [] } });
    await waitFor(() => expect(screen.getAllByText("Not loaded")).toHaveLength(4));
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("uses unique accessible ids across mounted instances and duplicate caller keys", async () => {
    const duplicateSurface = {
      sections: [
        { key: "profile", label: "Caller profile", status: "Ready", summary: "First.", details: [] },
        { key: "profile", label: "Caller profile duplicate", status: "Ready", summary: "Second.", details: [] },
      ],
    };
    render(<>
      {dialog({ open: true, surface: duplicateSurface })}
      {dialog({ open: true, surface: duplicateSurface })}
    </>);
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(2));

    const dialogs = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"));
    expect(dialogs).toHaveLength(2);
    const titleIds = dialogs.map((item) => item.getAttribute("aria-labelledby"));
    expect(new Set(titleIds).size).toBe(2);
    for (const item of dialogs) {
      const titleId = item.getAttribute("aria-labelledby");
      expect(titleId).toBeTruthy();
      expect(item.ownerDocument.getElementById(titleId!)?.tagName).toBe("H2");
    }

    const labelledSections = dialogs.flatMap((item) => Array.from(item.querySelectorAll("section[aria-labelledby]")));
    const sectionHeadingIds = labelledSections.map((item) => item.getAttribute("aria-labelledby"));
    expect(new Set(sectionHeadingIds).size).toBe(sectionHeadingIds.length);
    expect(labelledSections.every((item) => item.querySelector("h3")?.id === item.getAttribute("aria-labelledby"))).toBe(true);
  });

  it("renders caller-owned surface sections without list metadata flattening", () => {
    render(dialog({
      open: true,
      surface: {
        sections: [{
          key: "map-coverage",
          label: "Map coverage",
          status: "Truncated",
          summary: "Two edge families reached their bounded limit.",
          details: [{ label: "Affected families", value: "Service routes, workload owners" }],
        }],
      },
    }));

    const section = screen.getByRole("region", { name: "Map coverage" });
    expect(section.textContent).toContain("Two edge families reached their bounded limit");
    expect(screen.queryByRole("heading", { name: "Snapshot" })).toBeNull();
  });

  it("aborts and ignores stale completion when context changes", async () => {
    let resolveOld: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    let resolveNew: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    vi.mocked(apiGetWithContext)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const view = render(dialog({ open: true, activeContext: "old-context" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(apiGetWithContext).mock.calls[0][3]?.signal;
    view.rerender(dialog({ open: true, activeContext: "new-context" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);

    resolveOld?.(response("old-context", "stale-profile"));
    resolveNew?.(response("new-context", "current-profile"));
    expect(await screen.findByText("Current Profile")).toBeTruthy();
    expect(screen.queryByText("Stale Profile")).toBeNull();
  });

  it("aborts and ignores stale completion when token changes", async () => {
    let resolveOld: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    let resolveNew: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    vi.mocked(apiGetWithContext)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));

    const view = render(dialog({ open: true, token: "old-token" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(apiGetWithContext).mock.calls[0][3]?.signal;
    view.rerender(dialog({ open: true, token: "new-token" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(2));
    expect(oldSignal?.aborted).toBe(true);
    expect(apiGetWithContext).toHaveBeenLastCalledWith(
      "/api/dataplane/explanation",
      "new-token",
      "kind-dev",
      { signal: expect.any(AbortSignal) },
    );

    resolveOld?.(response("kind-dev", "stale-profile"));
    resolveNew?.(response("kind-dev", "current-profile"));
    expect(await screen.findByText("Current Profile")).toBeTruthy();
    expect(screen.queryByText("Stale Profile")).toBeNull();
    expect(apiGetWithContext).toHaveBeenCalledTimes(2);
  });

  it("rejects a response for a different active context", async () => {
    vi.mocked(apiGetWithContext).mockResolvedValueOnce(response("other-context", "wrong-profile"));
    render(dialog({ open: true }));
    expect((await screen.findByRole("alert")).textContent).toContain("Runtime explanation unavailable");
    expect(screen.queryByText("Wrong Profile")).toBeNull();
  });

  it("keeps authoritative surface metadata visible when runtime fails", async () => {
    vi.mocked(apiGetWithContext).mockRejectedValueOnce(new Error("endpoint down"));
    render(dialog({ open: true }));

    expect(await screen.findByText("Hot snapshot. Full scope. Complete detail.")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toBe("Runtime explanation unavailable");
  });

  it("aborts and resets runtime and error state across close and reopen", async () => {
    let resolveReopen: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    let resolveAfterError: ((value: ApiDataplaneExplanationResponse) => void) | undefined;
    vi.mocked(apiGetWithContext)
      .mockResolvedValueOnce(response("kind-dev", "prior-profile"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveReopen = resolve; }))
      .mockRejectedValueOnce(new Error("endpoint down"))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAfterError = resolve; }));
    const view = render(dialog({ open: true }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Prior Profile")).toBeTruthy();
    const signal = vi.mocked(apiGetWithContext).mock.calls[0][3]?.signal;
    view.rerender(dialog({ open: false }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    view.rerender(dialog({ open: true }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Prior Profile")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    resolveReopen?.(response("kind-dev", "fresh-profile"));
    expect(await screen.findByText("Fresh Profile")).toBeTruthy();

    view.rerender(dialog({ open: true, token: "error-token" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    view.rerender(dialog({ open: false, token: "error-token" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(dialog({ open: true, token: "error-token" }));
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Fresh Profile")).toBeNull();
    resolveAfterError?.(response("kind-dev", "final-profile"));
    expect(await screen.findByText("Final Profile")).toBeTruthy();
  });

  it("calls onClose from its compact close action", () => {
    const onClose = vi.fn();
    render(dialog({ open: true, onClose }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
