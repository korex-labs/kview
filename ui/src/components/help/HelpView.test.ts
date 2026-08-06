import { describe, expect, it } from "vitest";
import whatsNew from "../../../../docs/user/whats-new.md?raw";
import { changelogUrl, limitWhatsNewHighlights } from "./HelpView";

describe("Help changelog links", () => {
  it("targets the repository default branch", () => {
    expect(changelogUrl).toBe("https://github.com/korex-labs/kview/blob/master/CHANGELOG.md");
    expect(whatsNew).toContain("https://github.com/korex-labs/kview/blob/master/CHANGELOG.md");
    expect(whatsNew).not.toContain("https://github.com/korex-labs/kview/blob/main/CHANGELOG.md");
  });
});

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
