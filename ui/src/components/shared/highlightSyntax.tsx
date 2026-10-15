import React from "react";
import { useTheme } from "@mui/material/styles";
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import prism from "react-syntax-highlighter/dist/esm/styles/prism/prism";
import type { SyntaxHighlightProps } from "./SyntaxHighlight";

// Only the requested grammar (and its declared Prism dependencies) is fetched.
const grammars: Record<string, () => Promise<{ default: unknown }>> = {
  yaml: () => import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
  json: () => import("react-syntax-highlighter/dist/esm/languages/prism/json"),
  toml: () => import("react-syntax-highlighter/dist/esm/languages/prism/toml"),
  markup: () => import("react-syntax-highlighter/dist/esm/languages/prism/markup"),
  ini: () => import("react-syntax-highlighter/dist/esm/languages/prism/ini"),
  bash: () => import("react-syntax-highlighter/dist/esm/languages/prism/bash"),
  sql: () => import("react-syntax-highlighter/dist/esm/languages/prism/sql"),
  javascript: () => import("react-syntax-highlighter/dist/esm/languages/prism/javascript"),
  typescript: () => import("react-syntax-highlighter/dist/esm/languages/prism/typescript"),
  python: () => import("react-syntax-highlighter/dist/esm/languages/prism/python"),
  ruby: () => import("react-syntax-highlighter/dist/esm/languages/prism/ruby"),
  go: () => import("react-syntax-highlighter/dist/esm/languages/prism/go"),
  css: () => import("react-syntax-highlighter/dist/esm/languages/prism/css"),
  hcl: () => import("react-syntax-highlighter/dist/esm/languages/prism/hcl"),
  markdown: () => import("react-syntax-highlighter/dist/esm/languages/prism/markdown"),
  php: () => import("react-syntax-highlighter/dist/esm/languages/prism/php"),
  java: () => import("react-syntax-highlighter/dist/esm/languages/prism/java"),
  csv: () => import("react-syntax-highlighter/dist/esm/languages/prism/csv"),
};

export async function loadSyntaxLanguage(language: string) {
  const grammar = await grammars[language]();
  PrismLight.registerLanguage(language, grammar.default);
  return { default: HighlightedSyntax };
}

function HighlightedSyntax({ appearance, ...props }: SyntaxHighlightProps) {
  const theme = useTheme();
  const style = appearance === "prism" ? prism : theme.palette.mode === "dark" ? oneDark : oneLight;
  return <PrismLight {...props} style={style} />;
}
