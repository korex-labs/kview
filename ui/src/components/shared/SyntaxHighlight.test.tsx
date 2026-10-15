// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SyntaxHighlight from "./SyntaxHighlight";
import CodeBlock from "./CodeBlock";

const load = vi.hoisted(() => vi.fn());
vi.mock("./highlightSyntax", () => ({ loadSyntaxLanguage: load }));
afterEach(() => { cleanup(); load.mockReset(); });

describe("deferred syntax rendering", () => {
  it("renders arbitrary fences safely without fetching a highlighter", () => {
    const code = "<script>alert('no')</script>\nnext";
    const view = render(<SyntaxHighlight language="unknown" wrapLongLines>{code}</SyntaxHighlight>);
    expect(view.container.querySelector("code")?.textContent).toBe(code);
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("code")?.style.whiteSpace).toBe("pre-wrap");
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps folded YAML independent of Prism", () => {
    const view = render(<CodeBlock code={"kind: Pod\nstatus:\n  phase: Running"} language="yaml" smartCollapse showCopy={false} />);
    expect(view.container.textContent).toContain("status");
    expect(view.container.textContent).not.toContain("Running");
    expect(load).not.toHaveBeenCalled();
  });

  it("shows readable fallback, loads a canonical grammar once, and preserves props", async () => {
    let resolve!: (value: { default: React.ComponentType<{ children: string }> }) => void;
    load.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<SyntaxHighlight language="js" customStyle={{ padding: "12px" }}>{"const n = 1;"}</SyntaxHighlight>);
    expect(view.container.querySelector("code")?.textContent).toBe("const n = 1;");
    expect(view.container.querySelector("pre")?.style.padding).toBe("12px");
    await waitFor(() => expect(load).toHaveBeenCalledWith("javascript"));
    await act(async () => resolve({ default: ({ children }) => <pre data-highlighted>{children}</pre> }));
    expect(view.container.querySelector("[data-highlighted]")?.textContent).toBe("const n = 1;");
    view.rerender(<SyntaxHighlight language="javascript">{"const n = 2;"}</SyntaxHighlight>);
    expect(view.container.textContent).toBe("const n = 2;");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retains readable source when a deferred chunk fails", async () => {
    load.mockRejectedValue(new Error("offline"));
    const view = render(<SyntaxHighlight language="json">{'{"ok":true}'}</SyntaxHighlight>);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(load).toHaveBeenCalledWith("json"));
    expect(view.container.querySelector("code")?.textContent).toBe('{"ok":true}');
  });
});
