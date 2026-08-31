import type { Section } from "../state";

export const keyboardActionIds = [
  "help.open",
  "search.focus",
  "table.filter.focus",
  "table.grid.focus",
  "table.cell.up",
  "table.cell.down",
  "table.cell.left",
  "table.cell.right",
  "table.page.previous",
  "table.page.next",
  "command.open",
  "activity.panel.toggle",
  "activity.panel.activities",
  "activity.panel.work",
  "activity.panel.terminals",
  "activity.panel.portForwards",
  "activity.panel.logs",
  "table.row.open",
  "nav.pods",
  "nav.dashboard",
  "nav.daemonsets",
  "nav.statefulsets",
  "nav.replicasets",
  "nav.cronjobs",
  "nav.horizontalpodautoscalers",
  "nav.networkpolicies",
  "nav.secrets",
  "nav.serviceaccounts",
  "nav.roles",
  "nav.rolebindings",
  "nav.clusterroles",
  "nav.clusterrolebindings",
  "nav.persistentvolumes",
  "nav.persistentvolumeclaims",
  "nav.resourcequotas",
  "nav.limitranges",
  "nav.customresourcedefinitions",
  "nav.customresources",
  "nav.clusterresources",
  "nav.helmcharts",
  "nav.deployments",
  "nav.services",
  "nav.ingresses",
  "nav.namespaces",
  "nav.nodes",
  "nav.jobs",
  "nav.configmaps",
  "nav.helm",
  "nav.context",
  "nav.settings",
  "drawer.tab.resourceMap",
  "drawer.tab.notes",
  "drawer.tab.overview",
  "drawer.tab.signals",
  "drawer.tab.containers",
  "drawer.tab.resources",
  "drawer.tab.networking",
  "drawer.tab.events",
  "drawer.tab.logs",
  "drawer.tab.metadata",
  "drawer.tab.yaml",
  "drawer.tab.pods",
  "drawer.tab.spec",
  "drawer.tab.keys",
  "drawer.tab.rules",
  "drawer.tab.tls",
  "drawer.tab.versions",
  "drawer.tab.namespaces",
  "drawer.tab.conditions",
  "drawer.tab.inventory",
  "drawer.tab.capacity",
  "drawer.tab.subjects",
  "drawer.tab.role-bindings",
  "drawer.tab.role-ref",
  "drawer.tab.jobs",
  "drawer.tab.values",
  "drawer.tab.manifest",
  "drawer.tab.hooks",
  "drawer.tab.history",
  "pod.portForward",
  "drawer.editYaml",
  "drawer.refresh",
] as const;

export type KeyboardActionId = (typeof keyboardActionIds)[number];
export type KeyboardActionGroup = "Global" | "Navigation" | "Table" | "Command Mode" | "Drawer";
export type KeyboardActionScope = "app" | "table" | "drawer" | "pod-drawer" | "dialog" | "settings" | "terminal";
export type KeySequence = string[];
export type KeyboardPresetId = "kview-classic" | "vim-k9s" | "browser-safe";
export type KeyboardActionSafety = "safe" | "confirm" | "dangerous";

export type KeyboardActionDefinition = {
  id: KeyboardActionId;
  label: string;
  group: KeyboardActionGroup;
  scopes: KeyboardActionScope[];
  safety: KeyboardActionSafety;
  maxSequenceLength?: number;
  section?: Section;
};

export type EffectiveKeyboardAction = KeyboardActionDefinition & {
  bindings: KeySequence[];
};

export type KeyboardActionHandler = () => boolean | void;
export type KeyboardActionHandlers = Partial<Record<KeyboardActionId, KeyboardActionHandler>>;
export type DrawerTabActionId = Extract<KeyboardActionId, `drawer.tab.${string}`>;

export const drawerTabActionAttribute = "data-keyboard-action-id";

export function drawerTabProps(actionId: DrawerTabActionId): { "data-keyboard-action-id": DrawerTabActionId } {
  return { "data-keyboard-action-id": actionId };
}

const definition = (
  id: KeyboardActionId,
  label: string,
  group: KeyboardActionGroup,
  scopes: KeyboardActionScope[],
  section?: Section,
): KeyboardActionDefinition => ({ id, label, group, scopes, safety: "safe", ...(section ? { section } : {}) });

export const drawerTabActions = [
  ["resource map", "resourceMap", "Resource Map"], ["notes", "notes", "Notes"], ["overview", "overview", "Overview"], ["signals", "signals", "Signals"],
  ["containers", "containers", "Containers"], ["resources", "resources", "Resources"],
  ["networking", "networking", "Networking"], ["events", "events", "Events"], ["logs", "logs", "Logs"],
  ["metadata", "metadata", "Metadata"], ["yaml", "yaml", "YAML"], ["pods", "pods", "Pods"],
  ["spec", "spec", "Spec"], ["keys", "keys", "Keys"], ["rules", "rules", "Rules"], ["tls", "tls", "TLS"],
  ["versions", "versions", "Versions"], ["namespaces", "namespaces", "Namespaces"],
  ["conditions", "conditions", "Conditions"], ["inventory", "inventory", "Inventory"],
  ["capacity", "capacity", "Capacity"], ["subjects", "subjects", "Subjects"],
  ["role bindings", "role-bindings", "Role Bindings"], ["role ref", "role-ref", "Role Ref"], ["jobs", "jobs", "Jobs"],
  ["values", "values", "Values"], ["manifest", "manifest", "Manifest"], ["hooks", "hooks", "Hooks"],
  ["history", "history", "History"],
] as const;

export const drawerTabActionIdByLabel = new Map<string, KeyboardActionId>(
  drawerTabActions.map(([label, slug]) => [label, `drawer.tab.${slug}` as KeyboardActionId]),
);

export const actionDefinitions: KeyboardActionDefinition[] = [
  definition("help.open", "Show keyboard shortcuts", "Global", ["app"]),
  definition("search.focus", "Focus header search and command input", "Global", ["app"]),
  definition("activity.panel.toggle", "Toggle activity panel", "Global", ["app"]),
  definition("activity.panel.activities", "Open Activities tab", "Global", ["app"]),
  definition("activity.panel.work", "Open Work tab", "Global", ["app"]),
  definition("activity.panel.terminals", "Open Terminals tab", "Global", ["app"]),
  definition("activity.panel.portForwards", "Open Port forwards tab", "Global", ["app"]),
  definition("activity.panel.logs", "Open Logs tab", "Global", ["app"]),
  definition("table.filter.focus", "Focus current table filter", "Table", ["app"]),
  definition("table.grid.focus", "Focus resource table", "Table", ["app"]),
  { ...definition("table.cell.up", "Move up in the table", "Table", ["table"]), maxSequenceLength: 1 },
  { ...definition("table.cell.down", "Move down in the table", "Table", ["table"]), maxSequenceLength: 1 },
  { ...definition("table.cell.left", "Move left in the table", "Table", ["table"]), maxSequenceLength: 1 },
  { ...definition("table.cell.right", "Move right in the table", "Table", ["table"]), maxSequenceLength: 1 },
  definition("table.page.previous", "Previous table page", "Table", ["app"]),
  definition("table.page.next", "Next table page", "Table", ["app"]),
  definition("command.open", "Open command suggestions", "Global", ["app"]),
  definition("table.row.open", "Open selected row", "Table", ["app"]),
  definition("nav.pods", "Go to Pods", "Navigation", ["app"], "pods"),
  definition("nav.dashboard", "Go to Dashboard", "Navigation", ["app"], "dashboard"),
  definition("nav.deployments", "Go to Deployments", "Navigation", ["app"], "deployments"),
  definition("nav.services", "Go to Services", "Navigation", ["app"], "services"),
  definition("nav.ingresses", "Go to Ingresses", "Navigation", ["app"], "ingresses"),
  definition("nav.namespaces", "Go to Namespaces", "Navigation", ["app"], "namespaces"),
  definition("nav.nodes", "Go to Nodes", "Navigation", ["app"], "nodes"),
  definition("nav.jobs", "Go to Jobs", "Navigation", ["app"], "jobs"),
  definition("nav.configmaps", "Go to Config Maps", "Navigation", ["app"], "configmaps"),
  definition("nav.helm", "Go to Helm Releases", "Navigation", ["app"], "helm"),
  definition("nav.daemonsets", "Go to Daemon Sets", "Navigation", ["app"], "daemonsets"),
  definition("nav.statefulsets", "Go to Stateful Sets", "Navigation", ["app"], "statefulsets"),
  definition("nav.replicasets", "Go to Replica Sets", "Navigation", ["app"], "replicasets"),
  definition("nav.cronjobs", "Go to Cron Jobs", "Navigation", ["app"], "cronjobs"),
  definition("nav.horizontalpodautoscalers", "Go to Horizontal Pod Autoscalers", "Navigation", ["app"], "horizontalpodautoscalers"),
  definition("nav.networkpolicies", "Go to Network Policies", "Navigation", ["app"], "networkpolicies"),
  definition("nav.secrets", "Go to Secrets", "Navigation", ["app"], "secrets"),
  definition("nav.serviceaccounts", "Go to Service Accounts", "Navigation", ["app"], "serviceaccounts"),
  definition("nav.roles", "Go to Roles", "Navigation", ["app"], "roles"),
  definition("nav.rolebindings", "Go to Role Bindings", "Navigation", ["app"], "rolebindings"),
  definition("nav.clusterroles", "Go to Cluster Roles", "Navigation", ["app"], "clusterroles"),
  definition("nav.clusterrolebindings", "Go to Cluster Role Bindings", "Navigation", ["app"], "clusterrolebindings"),
  definition("nav.persistentvolumes", "Go to Persistent Volumes", "Navigation", ["app"], "persistentvolumes"),
  definition("nav.persistentvolumeclaims", "Go to Persistent Volume Claims", "Navigation", ["app"], "persistentvolumeclaims"),
  definition("nav.resourcequotas", "Go to Resource Quotas", "Navigation", ["app"], "resourcequotas"),
  definition("nav.limitranges", "Go to Limit Ranges", "Navigation", ["app"], "limitranges"),
  definition("nav.customresourcedefinitions", "Go to Custom Resource Definitions", "Navigation", ["app"], "customresourcedefinitions"),
  definition("nav.customresources", "Go to Custom Resources", "Navigation", ["app"], "customresources"),
  definition("nav.clusterresources", "Go to Cluster Resources", "Navigation", ["app"], "clusterresources"),
  definition("nav.helmcharts", "Go to Helm Charts", "Navigation", ["app"], "helmcharts"),
  definition("nav.context", "Open context command suggestions", "Navigation", ["app"]),
  definition("nav.settings", "Open settings", "Navigation", ["app"]),
  ...drawerTabActions.map(([, slug, label]) => definition(`drawer.tab.${slug}` as KeyboardActionId, `Open ${label} tab`, "Drawer", ["drawer"])),
  definition("pod.portForward", "Open Pod port-forward dialog", "Drawer", ["pod-drawer"]),
  definition("drawer.editYaml", "Edit YAML when available", "Drawer", ["drawer"]),
  definition("drawer.refresh", "Refresh current resource when available", "Drawer", ["drawer"]),
];

export const actionDefinitionById = new Map(actionDefinitions.map((action) => [action.id, action]));

export function isKeyboardActionId(value: unknown): value is KeyboardActionId {
  return typeof value === "string" && actionDefinitionById.has(value as KeyboardActionId);
}
