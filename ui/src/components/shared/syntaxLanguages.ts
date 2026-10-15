// Keep this registry free of runtime highlighter imports. Unknown Help fences and
// custom-command languages are plain text; never construct an import from input.
export const syntaxLanguageAliases: Readonly<Record<string, string>> = {
  yaml: "yaml",
  json: "json",
  toml: "toml",
  markup: "markup",
  ini: "ini",
  bash: "bash",
  sql: "sql",
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  ruby: "ruby",
  go: "go",
  css: "css",
  hcl: "hcl",
  markdown: "markdown",
  php: "php",
  java: "java",
  csv: "csv",
  yml: "yaml",
  xml: "markup",
  html: "markup",
  svg: "markup",
  mathml: "markup",
  ssml: "markup",
  atom: "markup",
  rss: "markup",
  sh: "bash",
  shell: "bash",
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  md: "markdown",
  webmanifest: "json",
};

export function normalizeSyntaxLanguage(language?: string): string | undefined {
  const key = language?.trim().toLowerCase() || "";
  return Object.prototype.hasOwnProperty.call(syntaxLanguageAliases, key) ? syntaxLanguageAliases[key] : undefined;
}
