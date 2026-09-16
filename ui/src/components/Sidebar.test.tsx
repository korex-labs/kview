// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Sidebar from "./Sidebar";

afterEach(cleanup);

const baseProps = {
  contexts: [{ name: "test" }], activeContext: "test", onSelectContext: vi.fn(),
  namespaces: [], namespace: "default", nsLimited: false,
  favourites: [], onToggleFavourite: vi.fn(), onToggleGroup: vi.fn(),
  section: "pods" as const, onSelectSection: vi.fn(),
};

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
