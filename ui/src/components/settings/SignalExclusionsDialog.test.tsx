// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignalExclusionsDialog, { canAddSignalExclusionRule } from "./SignalExclusionsDialog";

afterEach(cleanup);

describe("SignalExclusionsDialog", () => {
  it("creates a structured exclusion rule", () => {
    const onSave = vi.fn();
    render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="global"
        inheritedRules={[]}
        onClose={() => undefined}
        onSave={onSave}
        onUseInherited={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add exclusion rule" }));
    const pattern = screen.getByLabelText("RE2 pattern");
    fireEvent.change(pattern, { target: { value: "^canary-" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Expected canary" } });
    fireEvent.click(screen.getByRole("button", { name: "Save exclusions" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].rules).toHaveLength(1);
    expect(onSave.mock.calls[0][0].rules[0]).toMatchObject({
      enabled: true,
      description: "Expected canary",
      match: "all",
      conditions: [{ source: "name", operator: "regex", pattern: "^canary-" }],
    });
  });

  it("supports explicit empty context replacement and returning to global rules", () => {
    const onSave = vi.fn();
    const onUseInherited = vi.fn();
    const { rerender } = render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="context"
        contextName="prod"
        inheritedRules={[{ id: "global", conditions: [{ source: "name", pattern: "^global-" }] }]}
        exclusions={{ rules: [] }}
        onClose={() => undefined}
        onSave={onSave}
        onUseInherited={onUseInherited}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save exclusions" }));
    expect(onSave).toHaveBeenCalledWith({ rules: [] });

    rerender(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="context"
        contextName="prod"
        inheritedRules={[{ id: "global", conditions: [{ source: "name", pattern: "^global-" }] }]}
        exclusions={{ rules: [] }}
        onClose={() => undefined}
        onSave={onSave}
        onUseInherited={onUseInherited}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use global rules" }));
    expect(onUseInherited).toHaveBeenCalledTimes(1);
  });

  it("previews draft rules against cached candidates", async () => {
    const onPreview = vi.fn().mockResolvedValue({
      candidateCount: 2,
      matchedCount: 1,
      items: [{ resourceKind: "Pod", namespace: "apps", resourceName: "api-0" }],
    });
    render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="global"
        inheritedRules={[]}
        exclusions={{ rules: [{ id: "api", conditions: [{ source: "name", pattern: "^api-0$" }] }] }}
        onClose={() => undefined}
        onSave={() => undefined}
        onUseInherited={() => undefined}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview matches" }));
    expect(await screen.findByText(/Matches 1 of 2 cached candidates/i)).toBeTruthy();
    expect(screen.getByText(/Pod apps\/api-0/)).toBeTruthy();
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it("validates with the backend before saving when preview is available", async () => {
    const onSave = vi.fn();
    const onPreview = vi.fn().mockRejectedValue(new Error("invalid RE2 pattern"));
    render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="global"
        inheritedRules={[]}
        exclusions={{ rules: [{ id: "server-check", conditions: [{ source: "name", pattern: "^api$" }] }] }}
        onClose={() => undefined}
        onSave={onSave}
        onUseInherited={() => undefined}
        onPreview={onPreview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save exclusions" }));
    expect(await screen.findByText("invalid RE2 pattern")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("rejects common JavaScript-only regex constructs", () => {
    render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="global"
        inheritedRules={[]}
        exclusions={{ rules: [{ id: "lookahead", conditions: [{ source: "name", pattern: "api(?=-0)" }] }] }}
        onClose={() => undefined}
        onSave={() => undefined}
        onUseInherited={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Save exclusions" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getAllByText(/not supported by RE2/i).length).toBeGreaterThan(0);
  });

  it("enforces the backend rule limit for add and duplicate controls", () => {
    expect(canAddSignalExclusionRule(49)).toBe(true);
    expect(canAddSignalExclusionRule(50)).toBe(false);
  });

  it("blocks saving an invalid regular expression", () => {
    render(
      <SignalExclusionsDialog
        open
        signalLabel="Pod restarts"
        scope="global"
        inheritedRules={[]}
        exclusions={{ rules: [{ id: "bad", conditions: [{ source: "name", pattern: "[" }] }] }}
        onClose={() => undefined}
        onSave={() => undefined}
        onUseInherited={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Save exclusions" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.getAllByText(/Invalid regular expression/i).length).toBeGreaterThan(0);
  });
});
