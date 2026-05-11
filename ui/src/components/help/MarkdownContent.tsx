import React from "react";
import { Box, Link, Typography } from "@mui/material";
import CodeBlock from "../shared/CodeBlock";
import ShortcutKey from "../../keyboard/ShortcutKey";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; language: string; code: string };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "list", items: list });
    list = [];
  };

  for (const line of lines) {
    const codeFence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (codeFence) {
      if (code) {
        blocks.push({ type: "code", language: codeLanguage || "text", code: code.join("\n") });
        code = null;
        codeLanguage = "";
      } else {
        flushParagraph();
        flushList();
        code = [];
        codeLanguage = codeFence[1] || "text";
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }

    const listItem = line.match(/^-\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    if (/^\s{2,}\S/.test(line) && list.length > 0) {
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (code) blocks.push({ type: "code", language: codeLanguage || "text", code: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function inlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(<kbd>.*?<\/kbd>|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("<kbd>")) {
      nodes.push(
        <ShortcutKey
          key={`${match.index}-kbd`}
          label={token.replace(/^<kbd>/, "").replace(/<\/kbd>$/, "")}
        />,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <Box key={`${match.index}-bold`} component="strong" sx={{ fontWeight: 700 }}>
          {token.slice(2, -2)}
        </Box>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <Box
          key={`${match.index}-code`}
          component="code"
          sx={{
            px: 0.5,
            py: 0.125,
            borderRadius: 0.75,
            bgcolor: "action.hover",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "0.86em",
          }}
        >
          {token.slice(1, -1)}
        </Box>,
      );
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <Link key={`${match.index}-link`} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </Link>,
        );
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function MarkdownContent({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const variant = block.level === 1 ? "h5" : block.level === 2 ? "h6" : "subtitle1";
          return (
            <Typography
              key={`heading-${index}`}
              variant={variant}
              component={block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3"}
              sx={{ mt: index === 0 ? 0 : 1.25, fontWeight: 700 }}
            >
              {block.text}
            </Typography>
          );
        }
        if (block.type === "list") {
          return (
            <Box
              key={`list-${index}`}
              component="ul"
              sx={{
                m: 0,
                pl: 2.5,
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
              }}
            >
              {block.items.map((item, itemIndex) => (
                <Box key={`${item}-${itemIndex}`} component="li" sx={{ pl: 0.25 }}>
                  <Typography variant="body2">{inlineMarkdown(item)}</Typography>
                </Box>
              ))}
            </Box>
          );
        }
        if (block.type === "code") {
          return <CodeBlock key={`code-${index}`} code={block.code} language={block.language} showCopy={false} />;
        }
        return (
          <Typography key={`paragraph-${index}`} variant="body2" color="text.primary">
            {inlineMarkdown(block.text)}
          </Typography>
        );
      })}
    </Box>
  );
}
