// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserSettingsProvider, useUserSettings } from "../../settingsContext";
import { defaultUserSettings, loadUserSettings, saveUserSettings } from "../../settings";
import CodeBlock from "./CodeBlock";
import SyntaxHighlight from "./SyntaxHighlight";
import MarkdownContent from "../help/MarkdownContent";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
const controls = () => screen.getAllByRole("group", { name: "Text viewer font size" });
const press = (name: string, index = 0) => fireEvent.click(within(controls()[index]).getByRole("button", { name }));

function Preferences() {
  const { setSettings } = useUserSettings();
  return <button onClick={() => setSettings((previous) => ({ ...previous, logs: { lines: 500, pretty: false, wrap: false } }))}>Log preferences</button>;
}

describe("shared text viewer zoom", () => {
  it("keeps YAML fold indicators, gutters and rows proportional at both zoom bounds", () => {
    render(<CodeBlock code={"kind: Pod\nmetadata:\n  name: fixture\nstatus:\n  phase: Running"} language="yaml" />);
    const pre = document.querySelector("pre")!;
    const fold = screen.getAllByTitle("Collapse")[0];
    const row = fold.parentElement!;
    fireEvent.click(fold);
    for (const [action, count, size] of [["Decrease text size", 3, "10px"], ["Increase text size", 14, "24px"]] as const) {
      for (let i = 0; i < count; i++) press(action);
      expect(getComputedStyle(pre.parentElement!).fontSize).toBe(size);
      expect(getComputedStyle(pre).lineHeight).toBe("1.5");
      expect(getComputedStyle(fold).fontSize).toBe(size);
      expect(getComputedStyle(fold).lineHeight).toBe("1.5");
      for (const cell of Array.from(row.children)) {
        expect(["", "0", "0px", "auto"]).toContain(getComputedStyle(cell).minHeight);
      }
      expect(fold.title).toBe("Expand");
      expect(screen.queryByText("fixture")).toBeNull();
    }
  });
  it("synchronizes mounted plain/YAML/highlighted viewers, preserves folds and copy payload, and reloads", async () => {
    const code = "kind: Pod\nstatus:\n  phase: Running";
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: copy } });
    const view = render(<UserSettingsProvider><Preferences />
      <section data-testid="yaml"><CodeBlock code={code} language="yaml" smartCollapse /></section>
      <section data-testid="plain"><CodeBlock code="plain payload" showCopy={false} /></section>
      <section data-testid="json"><CodeBlock code={'{"ok":true}'} language="json" showCopy={false} /></section>
      <section data-testid="help"><MarkdownContent markdown={'Ordinary prose\n\n```text\nfence payload\n```'} /></section>
      <section data-testid="editor"><SyntaxHighlight language="text" customStyle={{ fontSize: "0.85rem" }}>editable overlay</SyntaxHighlight></section>
    </UserSettingsProvider>);
    expect(controls()).toHaveLength(3);
    expect(screen.queryByText("Running")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log preferences" }));
    press("Increase text size");
    expect(screen.queryByText(/\d+ px/)).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    const plainBody = screen.getByText("plain payload").parentElement!;
    expect(getComputedStyle(plainBody).fontSize).toBe("14px");
    expect(getComputedStyle(screen.getByTestId("yaml").querySelector("pre")!.parentElement!).fontSize).toBe("14px");
    await waitFor(() => expect(screen.getByTestId("json").querySelector(".token")).not.toBeNull());
    expect(screen.getByTestId("json").querySelector("pre")!.style.fontSize).toBe("14px");
    expect(screen.getByTestId("json").querySelector("code")!.style.fontSize).toBe("inherit");
    expect(screen.getByTestId("editor").querySelector("pre")!.style.fontSize).toBe("0.85rem");
    expect(screen.getByTestId("help").querySelector("pre")!.style.fontSize).toBe("14px");
    // Overlay is anchored to the viewport, not the scrolling content; no footer.
    for (const group of controls()) {
      expect(group.textContent).toBe("");
      expect(getComputedStyle(group).position).toBe("absolute");
      expect(getComputedStyle(group).bottom).toBe("20px");
      expect(getComputedStyle(group).right).toBe("20px");
      expect(getComputedStyle(group).fontSize).toBe("14px");
      expect(getComputedStyle(group.parentElement!).position).toBe("relative");
      expect(getComputedStyle(group.previousElementSibling!).paddingBottom).toBe("52px");
      expect(within(group).getAllByRole("button")).toHaveLength(3);
    }
    expect(plainBody.contains(controls()[1])).toBe(false);
    expect(plainBody.parentElement).toBe(controls()[1].parentElement);
    fireEvent.click(within(screen.getByTestId("yaml")).getByTitle("Expand"));
    expect(screen.getByText("Running")).toBeTruthy();
    press("Increase text size", 1);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("plain payload").parentElement).toBe(plainBody);
    expect(loadUserSettings().logs).toEqual({ lines: 500, pretty: false, wrap: false });
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(15);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(copy).toHaveBeenCalledWith(code);
    view.unmount();
    render(<UserSettingsProvider><CodeBlock code="reloaded" /></UserSettingsProvider>);
    expect(getComputedStyle(screen.getByText("reloaded").parentElement!).fontSize).toBe("15px");
    press("Reset text size");
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(13);
  });

  it("clamps controls at both bounds and supports provider-free consumers", () => {
    const settings = defaultUserSettings();
    saveUserSettings({ ...settings, appearance: { ...settings.appearance, textViewerFontSizePx: 24 } });
    const view = render(<UserSettingsProvider><CodeBlock code="bounded" /></UserSettingsProvider>);
    expect((within(controls()[0]).getByRole("button", { name: "Increase text size" }) as HTMLButtonElement).disabled).toBe(true);
    press("Reset text size");
    for (let i = 0; i < 4; i++) press("Decrease text size");
    expect(getComputedStyle(screen.getByText("bounded").parentElement!).fontSize).toBe("10px");
    expect((within(controls()[0]).getByRole("button", { name: "Decrease text size" }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    render(<CodeBlock code="standalone" />);
    expect(getComputedStyle(screen.getByText("standalone").parentElement!).fontSize).toBe("13px");
    press("Increase text size");
    expect(getComputedStyle(screen.getByText("standalone").parentElement!).fontSize).toBe("14px");
    expect(loadUserSettings().appearance.textViewerFontSizePx).toBe(10);
  });
});
