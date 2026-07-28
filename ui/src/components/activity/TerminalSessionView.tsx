import React, { useCallback, useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { AppIconButton } from "../shared/AppActions";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useKeyboardControls } from "../../keyboard/KeyboardProvider";

type SessionSummary = {
  id: string;
  title: string;
  status: string;
  targetNamespace?: string;
  targetResource?: string;
  targetContainer?: string;
  metadata?: Record<string, string>;
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
  const { requestKeyboardFocus } = useKeyboardControls();
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
    return document.activeElement === input;
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
    let lastSentSize = { cols: 0, rows: 0 };

    const sendResize = () => {
      const cols = term.cols;
      const rows = term.rows;
      if (cols <= 0 || rows <= 0) return;
      if (lastSentSize.cols === cols && lastSentSize.rows === rows) return;
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
      lastSentSize = { cols, rows };
    };

    const tryFit = () => {
      fitRef.current?.fit();
      sendResize();
    };

    if (containerRef.current) {
      term.open(containerRef.current);
      window.requestAnimationFrame(() => {
        tryFit();
        requestKeyboardFocus({ id: "terminal.session", focus: focusTerminal });
      });
    }

    // WebSocket: token in query only (browser WS API cannot set Authorization header).
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
      sendResize();
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
        ws.send(new TextEncoder().encode(data));
      }
    });
    const resizeDisposable = term.onResize(() => {
      sendResize();
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
      resizeDisposable.dispose();
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
  }, [id, token, focusTerminal, requestKeyboardFocus]);

  useEffect(() => {
    if (!active) return;
    requestKeyboardFocus({ id: "terminal.session.active", focus: focusTerminal });
  }, [active, focusNonce, focusTerminal, requestKeyboardFocus]);

  const closeTerminal = useCallback(() => {
    if (!onClose) return;
    const socket = socketRef.current;
    if (session?.metadata?.terminalKind === "pod-debug" && socket?.readyState === WebSocket.OPEN) {
      socket.send(new TextEncoder().encode("exit\r"));
      window.setTimeout(onClose, 150);
      return;
    }
    onClose();
  }, [onClose, session?.metadata?.terminalKind]);

  useEffect(() => {
    const handleCloseRequest = (event: Event) => {
      const closeEvent = event as CustomEvent<{ id?: string }>;
      if (closeEvent.detail?.id === id) closeTerminal();
    };
    window.addEventListener("kview-terminal-close-request", handleCloseRequest);
    return () => window.removeEventListener("kview-terminal-close-request", handleCloseRequest);
  }, [closeTerminal, id]);

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
          <AppIconButton tooltip="Close terminal" label="Close terminal" onClick={closeTerminal}>
            <CloseIcon fontSize="small" />
          </AppIconButton>
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
