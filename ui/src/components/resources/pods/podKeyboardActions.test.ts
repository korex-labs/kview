import { describe, expect, it, vi } from "vitest";
import { buildPodKeyboardActions } from "./podKeyboardActions";

describe("buildPodKeyboardActions", () => {
  it("registers canonical typed IDs without physical fallback bindings", () => {
    const actions = buildPodKeyboardActions({
      logsDisabled: false,
      portForwardDisabled: false,
      openLogsAndFollow: vi.fn(),
      openPortForward: vi.fn(),
    });

    expect(actions.map((action) => action.id)).toEqual(["drawer.tab.logs", "pod.portForward"]);
    expect(actions[0].priority).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).not.toHaveProperty("binding");
      expect(action).not.toHaveProperty("bindings");
    }
  });

  it("keeps disabled handlers inert", () => {
    const openLogsAndFollow = vi.fn();
    const openPortForward = vi.fn();
    const actions = buildPodKeyboardActions({
      logsDisabled: true,
      portForwardDisabled: true,
      openLogsAndFollow,
      openPortForward,
    });

    expect(actions[0].run()).toBe(false);
    expect(actions[1].run()).toBe(false);
    expect(openLogsAndFollow).not.toHaveBeenCalled();
    expect(openPortForward).not.toHaveBeenCalled();
  });
});