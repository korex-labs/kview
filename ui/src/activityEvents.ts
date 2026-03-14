export const OPEN_TERMINAL_SESSION_EVENT = "kview:open-terminal-session";
export const FOCUS_PORT_FORWARDS_TAB_EVENT = "kview:focus-portforwards-tab";
export const FOCUS_LOGS_TAB_EVENT = "kview:focus-logs-tab";

export type OpenTerminalSessionEventDetail = {
  sessionId: string;
  source?: string;
  namespace?: string;
  pod?: string;
  container?: string;
};

export function emitOpenTerminalSession(detail: OpenTerminalSessionEventDetail) {
  window.dispatchEvent(
    new CustomEvent<OpenTerminalSessionEventDetail>(OPEN_TERMINAL_SESSION_EVENT, {
      detail,
    })
  );
}

export function emitFocusPortForwardsTab() {
  window.dispatchEvent(new CustomEvent(FOCUS_PORT_FORWARDS_TAB_EVENT));
}

export function emitFocusLogsTab() {
  window.dispatchEvent(new CustomEvent(FOCUS_LOGS_TAB_EVENT));
}
