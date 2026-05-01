import type { Section } from "../state";
import type { KeyboardSettings } from "../settings";

export type ShortcutGroup = "Global" | "Navigation" | "Table" | "Command Mode";

export type ShortcutCommandId =
  | "help.open"
  | "search.focus"
  | "table.filter.focus"
  | "table.grid.focus"
  | "table.cell.navigate"
  | "table.page.previous"
  | "table.page.next"
  | "command.open"
  | "table.row.open"
  | "nav.pods"
  | "nav.deployments"
  | "nav.services"
  | "nav.ingresses"
  | "nav.namespaces"
  | "nav.nodes"
  | "nav.jobs"
  | "nav.configmaps"
  | "nav.helm"
  | "nav.context"
  | "nav.settings";

export type ShortcutCommand = {
  id: ShortcutCommandId;
  label: string;
  group: ShortcutGroup;
  bindings: string[][];
  section?: Section;
};

export const shortcutCommands: ShortcutCommand[] = [
  { id: "help.open", label: "Show keyboard shortcuts", group: "Global", bindings: [["?"]] },
  { id: "search.focus", label: "Focus global search", group: "Global", bindings: [["ctrl+k"], ["s"]] },
  { id: "table.filter.focus", label: "Focus current table filter", group: "Table", bindings: [["/"]] },
  { id: "table.grid.focus", label: "Focus resource table", group: "Table", bindings: [["t"]] },
  { id: "table.cell.navigate", label: "Move around the table", group: "Table", bindings: [["Arrow keys"], ["h/j/k/l"], ["a/s/d/f"]] },
  { id: "table.page.previous", label: "Previous table page", group: "Table", bindings: [["["]] },
  { id: "table.page.next", label: "Next table page", group: "Table", bindings: [["]"]] },
  { id: "command.open", label: "Open command mode", group: "Command Mode", bindings: [[":"]] },
  { id: "table.row.open", label: "Open selected row", group: "Table", bindings: [["enter"]] },
  { id: "nav.pods", label: "Go to Pods", group: "Navigation", bindings: [["g", "p"]], section: "pods" },
  { id: "nav.deployments", label: "Go to Deployments", group: "Navigation", bindings: [["g", "d"]], section: "deployments" },
  { id: "nav.services", label: "Go to Services", group: "Navigation", bindings: [["g", "s"]], section: "services" },
  { id: "nav.ingresses", label: "Go to Ingresses", group: "Navigation", bindings: [["g", "i"]], section: "ingresses" },
  { id: "nav.namespaces", label: "Go to Namespaces", group: "Navigation", bindings: [["g", "n"]], section: "namespaces" },
  { id: "nav.nodes", label: "Go to Nodes", group: "Navigation", bindings: [["g", "o"]], section: "nodes" },
  { id: "nav.jobs", label: "Go to Jobs", group: "Navigation", bindings: [["g", "j"]], section: "jobs" },
  { id: "nav.configmaps", label: "Go to Config Maps", group: "Navigation", bindings: [["g", "c"]], section: "configmaps" },
  { id: "nav.helm", label: "Go to Helm Releases", group: "Navigation", bindings: [["g", "h"]], section: "helm" },
  { id: "nav.context", label: "Open context command suggestions", group: "Navigation", bindings: [["g", "x"]] },
  { id: "nav.settings", label: "Open settings", group: "Navigation", bindings: [["g", ","]] },
];

export function shortcutCommandsForSettings(settings: KeyboardSettings): ShortcutCommand[] {
  return shortcutCommands.map((command) => {
    if (command.id === "search.focus" && !settings.singleLetterGlobalSearch) {
      return {
        ...command,
        bindings: command.bindings.filter((binding) => binding.join(" ") !== "s"),
      };
    }
    if (command.id === "table.cell.navigate") {
      const bindings: string[][] = [["Arrow keys"]];
      if (settings.vimTableNavigation) bindings.push(["h/j/k/l"]);
      if (settings.homeRowTableNavigation) bindings.push(["a/s/d/f"]);
      return { ...command, bindings };
    }
    return command;
  });
}

export function formatBinding(binding: string[]): string {
  return binding
    .map((part) => part.split("+").map((piece) => {
      if (piece === "ctrl") return "Ctrl";
      if (piece === "meta") return "Meta";
      if (piece === "alt") return "Alt";
      if (piece === "shift") return "Shift";
      if (piece === "enter") return "Enter";
      return piece.length === 1 ? piece : piece[0].toUpperCase() + piece.slice(1);
    }).join("+"))
    .join(" then ");
}
