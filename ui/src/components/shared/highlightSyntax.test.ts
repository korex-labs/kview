import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadSyntaxLanguage } from "./highlightSyntax";
import { syntaxLanguageAliases } from "./syntaxLanguages";

describe("light Prism grammar loading", () => {
  it.each([...new Set(Object.values(syntaxLanguageAliases))])("loads and renders the %s grammar without the all-language entry", async (language) => {
    const { default: Highlight } = await loadSyntaxLanguage(language);
    const html = renderToStaticMarkup(React.createElement(Highlight, { language, children: "example: value" }));
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
  });

  it("actually tokenizes JSON and escapes markup in source", async () => {
    const { default: Highlight } = await loadSyntaxLanguage("json");
    const html = renderToStaticMarkup(React.createElement(Highlight, { language: "json", children: '{"message":"<script>"}' }));
    expect(html).toContain("token");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
