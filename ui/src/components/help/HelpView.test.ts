import { describe, expect, it } from "vitest";
import { limitWhatsNewHighlights } from "./HelpView";

describe("limitWhatsNewHighlights", () => {
  it("keeps only the first ten Recent Highlights bullets", () => {
    const markdown = [
      "Intro",
      "",
      "## Recent Highlights",
      "",
      "- One",
      "  continued",
      "- Two",
      "- Three",
      "- Four",
      "- Five",
      "- Six",
      "- Seven",
      "- Eight",
      "- Nine",
      "- Ten",
      "  still included",
      "- Eleven",
      "  removed continuation",
      "",
      "## Full History",
      "",
      "See changelog.",
    ].join("\n");

    const limited = limitWhatsNewHighlights(markdown);

    expect(limited).toContain("- One\n  continued");
    expect(limited).toContain("- Ten\n  still included");
    expect(limited).not.toContain("- Eleven");
    expect(limited).not.toContain("removed continuation");
    expect(limited).toContain("## Full History");
    expect(limited.match(/^- /gm)).toHaveLength(10);
  });
});
