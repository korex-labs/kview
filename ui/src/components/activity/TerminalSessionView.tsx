import React, { useCallback, useEffect, useRef } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import "xterm/css/xterm.css";

type SessionSummary = {
  id: string;
  title: string;
  status: string;
  targetNamespace?: string;
  targetResource?: string;
  targetContainer?: string;
};

type Props = {
  id: string;
  token: string;
  session?: SessionSummary;
  onClose?: () => void;
  active?: boolean;
  focusNonce?: number;
};

export default function TerminalSessionView({
  id,
  token,
  session,
  onClose,
  active = true,
  focusNonce = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const focusTerminal = useCallback(() => {
    fitRef.current?.fit();
    termRef.current?.focus();
    const input = containerRef.current?.querySelector(
      ".xterm-helper-textarea"
    ) as HTMLTextAreaElement | null;
    input?.focus();
  }, []);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 12,
      convertEol: true,
      cursorBlink: true,
      scrollback: 2000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    termRef.current = term;
    fitRef.current = fitAddon;

    const tryFit = () => {
      fitRef.current?.fit();
    };

    if (containerRef.current) {
      term.open(containerRef.current);
      window.requestAnimationFrame(() => {
        tryFit();
        focusTerminal();
      });
    }

    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const url =
      protocol +
      "//" +
      loc.host +
      `/api/sessions/${encodeURIComponent(id)}/terminal/ws?token=` +
      encodeURIComponent(token);

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      term.writeln("\x1b[32m[connected]\x1b[0m");
    };

    ws.onmessage = (ev) => {
      if (!term) return;
      if (typeof ev.data === "string") {
        term.write(ev.data);
      } else if (ev.data instanceof Blob) {
        ev.data.text().then((text) => {
          term.write(text);
        });
      }
    };

    ws.onclose = () => {
      term.writeln("\r\n\x1b[33m[disconnected]\x1b[0m");
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[error]\x1b[0m");
    };

    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const onResize = () => {
      tryFit();
    };
    window.addEventListener("resize", onResize);

    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(() => {
        tryFit();
      });
      resizeObserverRef.current.observe(containerRef.current);
    }

    return () => {
      disposable.dispose();
      window.removeEventListener("resize", onResize);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      term.dispose();
      fitRef.current = null;
    };
  }, [id, token, focusTerminal]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      focusTerminal();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, focusNonce, focusTerminal]);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: 1,
        border: "1px solid var(--border-subtle)",
        bgcolor: "var(--code-bg)",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1,
          py: 0.5,
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 500 }}>
          {session?.targetNamespace || "-"} / {session?.targetResource || "-"} / {session?.targetContainer || "-"}
        </Typography>
        {onClose && (
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          overflow: "hidden",
          "& .xterm": {
            fontFamily: "monospace",
            fontSize: "0.75rem",
          },
          "& .xterm-viewport": {
            overflowY: "auto !important",
            overflowX: "hidden !important",
          },
        }}
        tabIndex={0}
        onClick={() => {
          focusTerminal();
        }}
        onMouseDown={() => {
          focusTerminal();
        }}
      />
    </Box>
  );
}

