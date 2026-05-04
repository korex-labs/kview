import React, { useLayoutEffect, useRef, useState } from "react";
import { Box, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

type Props = {
  children: React.ReactNode;
  title: string;
  component?: React.ElementType;
  sx?: SxProps<Theme>;
};

export default function OverflowTooltip({ children, title, component = "span", sx }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const [overflowed, setOverflowed] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const updateOverflow = () => {
      setOverflowed(node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);
    };

    updateOverflow();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOverflow);
      return () => window.removeEventListener("resize", updateOverflow);
    }

    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [children, title]);

  const content = React.createElement(
    Box,
    {
      component,
      ref,
      sx: [
        {
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "block",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ],
    },
    children,
  );

  if (!overflowed || !title) return content;
  return (
    <Tooltip title={title} arrow>
      {content}
    </Tooltip>
  );
}
