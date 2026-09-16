// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGetWithContext } from "../../api";
import type { DataplaneListMeta } from "../../types/api";
import DataplaneListMetaStrip from "./DataplaneListMetaStrip";

vi.mock("../../api", () => ({ apiGetWithContext: vi.fn() }));

const meta: DataplaneListMeta = {
  state: "hot",
  freshness: "hot",
  coverage: "full",
  degradation: "none",
  completeness: "complete",
  observed: "not long ago",
};

beforeEach(() => {
  vi.mocked(apiGetWithContext).mockResolvedValue({ active: "kind-dev", item: { loaded: false, profile: "", observers: [] } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DataplaneListMetaStrip", () => {
  it("retains the existing compact metadata labels and adds Explain", () => {
    render(<DataplaneListMetaStrip meta={meta} token="token" activeContext="kind-dev" />);
    for (const label of ["Sync", "Updated", "Scope", "Issues", "Detail", "Checked"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Explain" })).toBeTruthy();
    expect(apiGetWithContext).not.toHaveBeenCalled();
  });

  it("matches the compact metadata chip height", () => {
    render(<DataplaneListMetaStrip meta={meta} token="token" activeContext="kind-dev" />);

    const explain = screen.getByRole("button", { name: "Explain" });
    const syncChip = screen.getByText("Sync").closest(".MuiChip-root");
    expect(syncChip).toBeTruthy();

    const chipStyle = getComputedStyle(syncChip!);
    const buttonStyle = getComputedStyle(explain);
    expect(buttonStyle.height).toBe(chipStyle.height);
    expect(buttonStyle.minHeight).toBe(chipStyle.height);
  });

  it("adapts list metadata into the authoritative snapshot section", async () => {
    render(<DataplaneListMetaStrip meta={{ ...meta, state: "denied" }} token="token" activeContext="kind-dev" />);
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    const snapshot = await screen.findByRole("region", { name: "Snapshot" });
    expect(snapshot.textContent).toContain("Access limited");
    expect(snapshot.textContent).not.toContain("Ready");
  });

  it("renders neither strip nor action without metadata", () => {
    const { container } = render(<DataplaneListMetaStrip meta={null} token="token" activeContext="kind-dev" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
  });

  it("opens the dialog and fetches runtime explanation only after clicking", async () => {
    render(<DataplaneListMetaStrip meta={meta} token="token" activeContext="kind-dev" />);
    expect(apiGetWithContext).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(await screen.findByRole("dialog", { name: "Dataplane explanation" })).toBeTruthy();
    await waitFor(() => expect(apiGetWithContext).toHaveBeenCalledTimes(1));
    expect(apiGetWithContext).toHaveBeenCalledWith(
      "/api/dataplane/explanation",
      "token",
      "kind-dev",
      { signal: expect.any(AbortSignal) },
    );
  });
});
