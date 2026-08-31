import {
  actionDefinitions,
  type EffectiveKeyboardAction,
  type KeyboardActionId,
  type KeyboardPresetId,
  type KeySequence,
} from "./actions";

export type KeyboardBindingOverrides = Record<string, KeySequence[]>;

export type KeyboardPreset = {
  id: KeyboardPresetId;
  label: string;
  description: string;
  bindings: Record<KeyboardActionId, KeySequence[]>;
};

const classicBindings: Record<KeyboardActionId, KeySequence[]> = {
  "help.open": [["?"]],
  "search.focus": [["ctrl+k"], ["s"]],
  "activity.panel.toggle": [["alt+a"], ["g", "a"]],
  "activity.panel.activities": [["alt+1"], ["g", "1"]],
  "activity.panel.work": [["alt+2"], ["g", "2"]],
  "activity.panel.terminals": [["alt+3"], ["g", "3"]],
  "activity.panel.portForwards": [["alt+4"], ["g", "4"]],
  "activity.panel.logs": [["alt+5"], ["g", "5"]],
  "table.filter.focus": [["/"]],
  "table.grid.focus": [["t"]],
  "table.cell.up": [["arrowup"], ["k"], ["d"]],
  "table.cell.down": [["arrowdown"], ["j"], ["s"]],
  "table.cell.left": [["arrowleft"], ["h"], ["a"]],
  "table.cell.right": [["arrowright"], ["l"], ["f"]],
  "table.page.previous": [["["]],
  "table.page.next": [["]"]],
  "command.open": [[":"]],
  "table.row.open": [["enter"]],
  "nav.pods": [["g", "p"]],
  "nav.dashboard": [["g", "0"]],
  "nav.deployments": [["g", "d"]],
  "nav.services": [["g", "s"]],
  "nav.ingresses": [["g", "i"]],
  "nav.namespaces": [["g", "n"]],
  "nav.nodes": [["g", "o"]],
  "nav.jobs": [["g", "j"]],
  "nav.configmaps": [["g", "c"]],
  "nav.helm": [["g", "h"]],
  "nav.daemonsets": [["g", "e"]],
  "nav.statefulsets": [["g", "f"]],
  "nav.replicasets": [["g", "r"]],
  "nav.cronjobs": [["g", "q"]],
  "nav.horizontalpodautoscalers": [["g", "w"]],
  "nav.networkpolicies": [["g", "space"]],
  "nav.secrets": [["g", "shift+!"]],
  "nav.serviceaccounts": [["g", "shift+@"]],
  "nav.roles": [["g", "shift+#"]],
  "nav.rolebindings": [["g", "shift+$"]],
  "nav.clusterroles": [["g", "shift+%"]],
  "nav.clusterrolebindings": [["g", "shift+^"]],
  "nav.persistentvolumes": [["g", "shift+&"]],
  "nav.persistentvolumeclaims": [["g", "shift+*"]],
  "nav.resourcequotas": [["g", "shift+("]],
  "nav.limitranges": [["g", "shift+)"]],
  "nav.customresourcedefinitions": [["g", "-"]],
  "nav.customresources": [["g", "="]],
  "nav.clusterresources": [["g", "shift+plus"]],
  "nav.helmcharts": [["g", "."]],
  "nav.context": [["g", "x"]],
  "nav.settings": [["g", ","]],
  "drawer.tab.resourceMap": [["shift+r"]],
  "drawer.tab.notes": [["n"]],
  "drawer.tab.overview": [["o"]],
  "drawer.tab.signals": [["s"]],
  "drawer.tab.containers": [["c"]],
  "drawer.tab.resources": [["u"]],
  "drawer.tab.networking": [["w"]],
  "drawer.tab.events": [["v"]],
  "drawer.tab.logs": [["l"]],
  "drawer.tab.metadata": [["m"]],
  "drawer.tab.yaml": [["y"]],
  "drawer.tab.pods": [["p"]],
  "drawer.tab.spec": [["x"]],
  "drawer.tab.keys": [["k"]],
  "drawer.tab.rules": [["q"]],
  "drawer.tab.tls": [["t"]],
  "drawer.tab.versions": [["b"]],
  "drawer.tab.namespaces": [["z"]],
  "drawer.tab.conditions": [["d"]],
  "drawer.tab.inventory": [["i"]],
  "drawer.tab.capacity": [["a"]],
  "drawer.tab.subjects": [["h"]],
  "drawer.tab.role-bindings": [["g"]],
  "drawer.tab.role-ref": [["f"]],
  "drawer.tab.jobs": [["j"]],
  "drawer.tab.values": [["shift+v"]],
  "drawer.tab.manifest": [["shift+m"]],
  "drawer.tab.hooks": [["shift+k"]],
  "drawer.tab.history": [["shift+h"]],
  "pod.portForward": [["shift+p"]],
  "drawer.editYaml": [["e"]],
  "drawer.refresh": [["r"]],
};

const vimBindings: Record<KeyboardActionId, KeySequence[]> = {
  ...classicBindings,
  "search.focus": [["ctrl+k"], ["/"]],
  "table.filter.focus": [["f"]],
  "table.cell.up": [["arrowup"], ["k"]],
  "table.cell.down": [["arrowdown"], ["j"]],
  "table.cell.left": [["arrowleft"], ["h"]],
  "table.cell.right": [["arrowright"], ["l"]],
  "table.page.previous": [["ctrl+b"], ["["]],
  "table.page.next": [["ctrl+f"], ["]"]],
};

const browserSafeBindings: Record<KeyboardActionId, KeySequence[]> = {
  ...classicBindings,
  "help.open": [["ctrl+alt+?"]],
  "search.focus": [["ctrl+k"]],
  "activity.panel.toggle": [["ctrl+alt+a"]],
  "activity.panel.activities": [["ctrl+alt+1"]],
  "activity.panel.work": [["ctrl+alt+2"]],
  "activity.panel.terminals": [["ctrl+alt+3"]],
  "activity.panel.portForwards": [["ctrl+alt+4"]],
  "activity.panel.logs": [["ctrl+alt+5"]],
  "table.filter.focus": [["ctrl+/"]],
  "table.grid.focus": [["ctrl+alt+t"]],
  "table.cell.up": [["arrowup"]],
  "table.cell.down": [["arrowdown"]],
  "table.cell.left": [["arrowleft"]],
  "table.cell.right": [["arrowright"]],
  "table.page.previous": [["ctrl+alt+["]],
  "table.page.next": [["ctrl+alt+]"]],
  "command.open": [["ctrl+alt+;"]],
  "nav.pods": [["ctrl+alt+p"]],
  "nav.dashboard": [["ctrl+alt+0"]],
  "nav.deployments": [["ctrl+alt+d"]],
  "nav.services": [["ctrl+alt+s"]],
  "nav.ingresses": [["ctrl+alt+i"]],
  "nav.namespaces": [["ctrl+alt+n"]],
  "nav.nodes": [["ctrl+alt+o"]],
  "nav.jobs": [["ctrl+alt+j"]],
  "nav.configmaps": [["ctrl+alt+c"]],
  "nav.helm": [["ctrl+alt+h"]],
  "nav.daemonsets": [["ctrl+alt+shift+d"]],
  "nav.statefulsets": [["ctrl+alt+shift+s"]],
  "nav.replicasets": [["ctrl+alt+shift+r"]],
  "nav.cronjobs": [["ctrl+alt+shift+j"]],
  "nav.horizontalpodautoscalers": [["ctrl+alt+shift+a"]],
  "nav.networkpolicies": [["ctrl+alt+shift+n"]],
  "nav.secrets": [["ctrl+alt+shift+e"]],
  "nav.serviceaccounts": [["ctrl+alt+shift+v"]],
  "nav.roles": [["ctrl+alt+shift+o"]],
  "nav.rolebindings": [["ctrl+alt+shift+b"]],
  "nav.clusterroles": [["ctrl+alt+shift+c"]],
  "nav.clusterrolebindings": [["ctrl+alt+shift+g"]],
  "nav.persistentvolumes": [["ctrl+alt+shift+p"]],
  "nav.persistentvolumeclaims": [["ctrl+alt+shift+l"]],
  "nav.resourcequotas": [["ctrl+alt+shift+q"]],
  "nav.limitranges": [["ctrl+alt+shift+i"]],
  "nav.customresourcedefinitions": [["ctrl+alt+shift+f"]],
  "nav.customresources": [["ctrl+alt+shift+u"]],
  "nav.clusterresources": [["ctrl+alt+shift+x"]],
  "nav.helmcharts": [["ctrl+alt+shift+h"]],
  "nav.context": [["ctrl+alt+x"]],
  "nav.settings": [["ctrl+alt+,"]],
};

export const keymapPresets: KeyboardPreset[] = [
  { id: "kview-classic", label: "kview Classic", description: "The original kview keyboard behavior.", bindings: classicBindings },
  { id: "vim-k9s", label: "Vim / k9s", description: "Vim-style table movement and operator navigation.", bindings: vimBindings },
  { id: "browser-safe", label: "Browser safe", description: "Avoids common browser and operating-system chords.", bindings: browserSafeBindings },
];

export const keymapPresetById = new Map(keymapPresets.map((preset) => [preset.id, preset]));

export function isKeyboardPresetId(value: unknown): value is KeyboardPresetId {
  return typeof value === "string" && keymapPresetById.has(value as KeyboardPresetId);
}

const cloneBindings = (bindings: KeySequence[]): KeySequence[] => bindings.map((sequence) => [...sequence]);

export function compileKeymap(
  presetId: KeyboardPresetId,
  overrides: KeyboardBindingOverrides = {},
): EffectiveKeyboardAction[] {
  const preset = keymapPresetById.get(presetId) ?? keymapPresetById.get("kview-classic")!;
  return actionDefinitions.map((definition) => ({
    ...definition,
    scopes: [...definition.scopes],
    bindings: cloneBindings(Object.prototype.hasOwnProperty.call(overrides, definition.id)
      ? overrides[definition.id] ?? preset.bindings[definition.id]
      : preset.bindings[definition.id]),
  }));
}
