// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useViewNavigation from "./useViewNavigation";
import { dispatchApplyFocusedResourceView } from "../focusedResourceViews";
import { loadListTextFilter, loadQuickFilterSelection, saveListTextFilter, saveQuickFilterSelection } from "../state";

beforeEach(() => { saveListTextFilter("original"); saveQuickFilterSelection(["original-quick"]); });
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

function mount() {
  let finish!: (accepted: boolean) => void;
  const options = {
    activeContext: "context-a",
    onSelectContext: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })),
    onSelectNamespace: vi.fn(), onSelectSection: vi.fn(),
  };
  const hook = renderHook(useViewNavigation, { initialProps: options });
  const begin = () => act(() => dispatchApplyFocusedResourceView({ context: "context-b", namespace: "ns-b", resource: "pods", filter: "target" }));
  return { ...hook, options, begin, finish: (accepted: boolean) => act(async () => { finish(accepted); }) };
}

describe("view navigation ownership", () => {
  it.each([true, false])("applies cross-context routing only on accepted=%s without duplicate listeners after rerender", async (accepted) => {
    const hook = mount();
    hook.rerender(hook.options);
    hook.begin();
    expect(hook.options.onSelectContext).toHaveBeenCalledExactlyOnceWith("context-b", "ns-b");
    expect(hook.options.onSelectNamespace).not.toHaveBeenCalled();
    expect(hook.options.onSelectSection).not.toHaveBeenCalled();
    expect(loadListTextFilter()).toBe("original");
    await hook.finish(accepted);
    if (accepted) {
      expect(hook.options.onSelectSection).toHaveBeenCalledExactlyOnceWith("pods");
      expect(loadListTextFilter()).toBe("target");
      expect(loadQuickFilterSelection()).toEqual([]);
    } else {
      expect(hook.options.onSelectSection).not.toHaveBeenCalled();
      expect(loadListTextFilter()).toBe("original");
      expect(loadQuickFilterSelection()).toEqual(["original-quick"]);
    }
  });

  it.each(["unmount", "section-choice", "new-intent"])("rejects late accepted routing after %s", async (reason) => {
    const hook = mount();
    hook.begin();
    if (reason === "unmount") hook.unmount();
    else if (reason === "section-choice") act(() => hook.result.current());
    else act(() => dispatchApplyFocusedResourceView({ resource: "deployments", filter: "newest" }));
    hook.options.onSelectSection.mockClear();
    await hook.finish(true);
    expect(hook.options.onSelectSection).not.toHaveBeenCalled();
    expect(loadListTextFilter()).toBe(reason === "new-intent" ? "newest" : "original");
    if (reason === "unmount") {
      act(() => dispatchApplyFocusedResourceView({ resource: "nodes" }));
      expect(hook.options.onSelectSection).not.toHaveBeenCalled();
    }
  });
});
