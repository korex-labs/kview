import type { ContextualKeyboardAction } from "../../../keyboard/KeyboardProvider";

export function buildPodKeyboardActions({
  logsDisabled,
  portForwardDisabled,
  openLogsAndFollow,
  openPortForward,
}: {
  logsDisabled: boolean;
  portForwardDisabled: boolean;
  openLogsAndFollow: () => void;
  openPortForward: () => void;
}): ContextualKeyboardAction[] {
  return [
    {
      id: "drawer.tab.logs",
      label: "Open logs and follow",
      priority: 100,
      disabled: logsDisabled,
      run: () => {
        if (logsDisabled) return false;
        openLogsAndFollow();
        return true;
      },
    },
    {
      id: "pod.portForward",
      label: "Open Pod port-forward dialog",
      disabled: portForwardDisabled,
      run: () => {
        if (portForwardDisabled) return false;
        openPortForward();
        return true;
      },
    },
  ];
}