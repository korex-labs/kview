// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); });

const baseProps = {
  contexts: [{ name: "test" }], activeContext: "test", onSelectContext: vi.fn(),
  namespaces: [], namespace: "default", nsLimited: false,
  favourites: [], onToggleFavourite: vi.fn(), onToggleGroup: vi.fn(),
  section: "pods" as const, onSelectSection: vi.fn(),
};

describe("Sidebar release checks", () => {
  it.each(["dev", "abc123def456", "v1.0.0"])("checks %s only after consent and aborts on opt-out", async (buildVersion) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      tag_name: "v5.17.0", html_url: "https://github.com/korex-labs/kview/releases/tag/v5.17.0",
    }) });
    vi.stubGlobal("fetch", fetchMock);
    const props = { ...baseProps, onSelectNamespace: vi.fn(), buildVersion, token: "local-token" };
    const view = render(<Sidebar {...props} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { view.rerender(<Sidebar {...props} releaseChecksEnabled />); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/releases/latest", expect.objectContaining({
      headers: { Accept: "application/json", Authorization: "Bearer local-token" },
    }));
    expect(screen.queryByText("Update v5.17.0") !== null).toBe(buildVersion === "v1.0.0");
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<Sidebar {...props} releaseChecksEnabled={false} />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText("Update v5.17.0")).toBeNull();
    view.unmount();
    await act(async () => { render(<Sidebar {...props} releaseChecksEnabled />); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // Fresh browser cache survives remount.
  });
});

describe("Sidebar namespace entry", () => {
  it.each([true, false])("manual entry capability %s is independent of RBAC limitation", (namespaceInventoryUnavailable) => {
    const onSelectNamespace = vi.fn();
    render(<Sidebar {...baseProps} {...{ namespaceInventoryUnavailable }} onSelectNamespace={onSelectNamespace} />);
    const input = screen.getByRole("combobox", { name: "Namespace" });
    fireEvent.change(input, { target: { value: "known-team" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    if (namespaceInventoryUnavailable) expect(onSelectNamespace).toHaveBeenCalledWith("known-team");
    else expect(onSelectNamespace).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: "known-team" })).toBeNull();
  });

  it("keeps restricted namespace manual input available", () => {
    const onSelectNamespace = vi.fn();
    render(<Sidebar {...baseProps} nsLimited onSelectNamespace={onSelectNamespace} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Namespace (manual)" }), { target: { value: "restricted-team" } });
    expect(onSelectNamespace).toHaveBeenCalledWith("restricted-team");
  });

  it("keeps cluster-scoped namespace input disabled even without inventory", () => {
    render(<Sidebar {...baseProps} {...{ namespaceInventoryUnavailable: true }} section="nodes" onSelectNamespace={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Namespace" }) as HTMLInputElement).disabled).toBe(true);
  });
});
