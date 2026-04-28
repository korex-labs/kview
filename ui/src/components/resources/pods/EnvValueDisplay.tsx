import React from "react";
import { Box, Chip, Link, Typography } from "@mui/material";
import { formatEnvScalar } from "../../../utils/envValues";

type EnvTone = "success" | "warning" | "error" | "info";

const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const trailingUrlPunctuation = /[),.;:!?]+$/;

function envTone(value: string): EnvTone | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "on", "enabled"].includes(normalized)) return "success";
  if (["false", "no", "off", "disabled"].includes(normalized)) return "error";
  if (["debug", "trace"].includes(normalized)) return "error";
  if (["warn", "warning"].includes(normalized)) return "warning";
  if (["info", "informational"].includes(normalized)) return "info";
  return null;
}

function linkedParts(value: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    const punctuation = rawUrl.match(trailingUrlPunctuation)?.[0] ?? "";
    const url = punctuation ? rawUrl.slice(0, -punctuation.length) : rawUrl;
    const end = start + url.length;

    if (start > lastIndex) out.push(value.slice(lastIndex, start));
    out.push(
      <Link key={`${url}-${start}`} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </Link>,
    );
    if (punctuation) out.push(punctuation);
    lastIndex = start + rawUrl.length;
  }
  if (lastIndex < value.length) out.push(value.slice(lastIndex));
  return out;
}

export default function EnvValueDisplay({ value, pretty }: { value: unknown; pretty: boolean }) {
  const text = formatEnvScalar(value);
  const commonSx = {
    fontFamily: "monospace",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  } as const;

  if (!pretty || text === "-") {
    return (
      <Typography component="span" variant="body2" sx={commonSx}>
        {text}
      </Typography>
    );
  }

  const tone = envTone(text);
  if (tone) {
    return <Chip size="small" color={tone} label={text} sx={{ fontFamily: "monospace" }} />;
  }

  if (urlPattern.test(text)) {
    urlPattern.lastIndex = 0;
    return (
      <Box component="span" sx={commonSx}>
        {linkedParts(text)}
      </Box>
    );
  }

  return (
    <Typography component="span" variant="body2" sx={commonSx}>
      {text}
    </Typography>
  );
}

