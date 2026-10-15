import React, { lazy, Suspense } from "react";
import { normalizeSyntaxLanguage } from "./syntaxLanguages";

export type SyntaxHighlightProps = {
  children: string;
  language?: string;
  /** Preserve the original Prism palette for log output; editors follow the app theme. */
  appearance?: "theme" | "prism";
  showLineNumbers?: boolean;
  wrapLongLines?: boolean;
  customStyle?: React.CSSProperties;
  codeTagProps?: React.HTMLAttributes<HTMLElement>;
  lineNumberStyle?: React.CSSProperties;
};

function PlainSyntax({ children, showLineNumbers, wrapLongLines, customStyle, codeTagProps, lineNumberStyle }: SyntaxHighlightProps) {
  return (
    <pre style={{ margin: 0, padding: "1em", overflowX: "auto", ...customStyle }}>
      <code {...codeTagProps} style={{ fontFamily: "monospace", whiteSpace: wrapLongLines ? "pre-wrap" : "pre", ...codeTagProps?.style }}>
        {showLineNumbers ? children.split("\n").map((line, index, lines) => (
          <React.Fragment key={index}>
            <span aria-hidden="true" style={{ display: "inline-block", minWidth: "2.25em", paddingRight: "1em", textAlign: "right", userSelect: "none", ...lineNumberStyle }}>{index + 1}</span>
            {line}{index < lines.length - 1 ? "\n" : ""}
          </React.Fragment>
        )) : children}
      </code>
    </pre>
  );
}

const highlighters = new Map<string, React.LazyExoticComponent<React.ComponentType<SyntaxHighlightProps>>>();

/** Plain/YAML-folded viewers never request Prism. Supported grammars load on use. */
export default function SyntaxHighlight(props: SyntaxHighlightProps) {
  const language = normalizeSyntaxLanguage(props.language);
  if (!language) return <PlainSyntax {...props} />;
  let Highlighter = highlighters.get(language);
  if (!Highlighter) {
    Highlighter = lazy(() => import("./highlightSyntax")
      .then((module) => module.loadSyntaxLanguage(language))
      // Keep code/edit overlays readable even if a deferred chunk cannot load.
      .catch(() => ({ default: PlainSyntax })));
    highlighters.set(language, Highlighter);
  }
  return (
    <Suspense fallback={<PlainSyntax {...props} />}>
      <Highlighter {...props} language={language} />
    </Suspense>
  );
}
