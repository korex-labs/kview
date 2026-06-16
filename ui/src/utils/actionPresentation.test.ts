import { afterEach, describe, expect, it } from "vitest";
import {
  applyActionPresentationDescriptors,
  getActionPresentation,
  resetActionPresentationsForTest,
} from "./actionPresentation";

afterEach(() => {
  resetActionPresentationsForTest();
});

describe("action presentation policy", () => {
  it("falls back from resource-specific ids to generic action ids", () => {
    expect(getActionPresentation("pod.delete")).toMatchObject({
      id: "pod.delete",
      label: "Delete",
      icon: "delete",
      color: "error",
    });
    expect(getActionPresentation("statefulset.scale")).toMatchObject({
      id: "statefulset.scale",
      label: "Scale",
      icon: "tune",
    });
  });

  it("applies backend-owned presentation descriptors", () => {
    const changed = applyActionPresentationDescriptors([
      { id: "delete", label: "Remove", icon: "delete", color: "error", order: 91 },
      { id: "custom.inspect", label: "Inspect", icon: "check", order: 5 },
      { id: "bad", label: "", icon: "missing", order: 1 },
    ]);

    expect(changed).toBe(true);
    expect(getActionPresentation("pod.delete")).toMatchObject({
      label: "Remove",
      icon: "delete",
      color: "error",
      order: 91,
    });
    expect(getActionPresentation("custom.inspect")).toMatchObject({
      label: "Inspect",
      icon: "check",
      order: 5,
    });
    expect(getActionPresentation("bad")).toBeUndefined();
  });
});
