import { describe, expect, it } from "vitest";
import { normalizeSyntaxLanguage, syntaxLanguageAliases } from "./syntaxLanguages";
import { detectLanguageFromKey } from "../../utils/syntaxDetect";

describe("on-demand syntax language allowlist", () => {
  it.each(Object.entries(syntaxLanguageAliases))("normalizes %s to %s", (alias, canonical) => {
    expect(normalizeSyntaxLanguage(` ${alias.toUpperCase()} `)).toBe(canonical);
  });

  it.each([undefined, "", "text", "plaintext", "unknown-fence", "../../all", "constructor", "__proto__", "toString"])("leaves %s as plain text", (language) => {
    expect(normalizeSyntaxLanguage(language)).toBeUndefined();
  });

  it.each(["yaml", "yml", "json", "toml", "xml", "properties", "ini", "conf", "sh", "bash", "env", "sql", "js", "ts", "py", "rb", "go", "html", "htm", "css", "tf"])("supports detected .%s config content", (extension) => {
    const language = detectLanguageFromKey(`config.${extension}`);
    expect(language).toBeTruthy();
    expect(normalizeSyntaxLanguage(language)).toBeTruthy();
  });
});
