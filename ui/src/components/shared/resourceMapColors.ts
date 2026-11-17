import { decomposeColor, getContrastRatio, type Theme } from "@mui/material/styles";
import type { ResourceIconName } from "../icons/resources/types";

export type ResourceMapFamily = "workload" | "pod" | "network" | "storage" | "config" | "access" | "cluster" | "unknown";

// Shape and color share the resource icon vocabulary; never infer type from a name
// or reuse severity red/yellow/green for neutral resource identity.
const families: Partial<Record<ResourceIconName, ResourceMapFamily>> = {
  workloads: "workload", deployments: "workload", daemonsets: "workload", statefulsets: "workload",
  replicasets: "workload", jobs: "workload", cronjobs: "workload", horizontalpodautoscalers: "workload",
  pods: "pod", networking: "network", services: "network", ingresses: "network", networkpolicies: "network",
  storage: "storage", persistentvolumes: "storage", persistentvolumeclaims: "storage",
  configuration: "config", configmaps: "config", secrets: "config", resourcequotas: "config", limitranges: "config",
  "access-control": "access", serviceaccounts: "access", roles: "access", rolebindings: "access",
  clusterroles: "access", clusterrolebindings: "access",
  cluster: "cluster", nodes: "cluster", namespaces: "cluster", clusterresources: "cluster",
};

export function resourceMapFamily(icon: ResourceIconName): ResourceMapFamily {
  return families[icon] ?? "unknown";
}

// Resolve alpha now, not in CSS: edges behind cards must never bleed through.
export function opaqueMapColor(foreground: string, background: string, opacity = 1): string {
  const fg = decomposeColor(foreground).values;
  const bg = decomposeColor(background).values;
  const alpha = (fg[3] ?? 1) * opacity;
  return `rgb(${fg.slice(0, 3).map((channel, index) => Math.round(channel * alpha + bg[index] * (1 - alpha))).join(", ")})`;
}

function readable(color: string, backgrounds: string[], minimum: number, theme: Theme): string {
  const end = theme.palette.mode === "dark" ? "#ffffff" : "#000000";
  for (let step = 0; step <= 20; step += 1) {
    const candidate = opaqueMapColor(end, color, step / 20);
    if (backgrounds.every((background) => getContrastRatio(candidate, background) >= minimum)) return candidate;
  }
  return end;
}

export function resourceMapColors(theme: Theme, icon: ResourceIconName = "customresources") {
  const { palette } = theme;
  const dark = palette.mode === "dark";
  const canvas = opaqueMapColor(palette.background.default, dark ? "#000000" : "#ffffff");
  const paper = opaqueMapColor(palette.background.paper, canvas);
  const blue = palette.primary.main;
  const teal = palette.info.main;
  const slate = palette.grey[dark ? 400 : 600];
  const tones: Record<ResourceMapFamily, string> = {
    workload: blue,
    pod: opaqueMapColor(teal, blue, 0.45),
    network: teal,
    storage: opaqueMapColor(teal, slate, 0.55),
    config: slate,
    access: opaqueMapColor(blue, slate, 0.45),
    cluster: slate,
    unknown: slate,
  };
  const family = resourceMapFamily(icon);
  const tone = tones[family];
  const fill = opaqueMapColor(tone, paper, dark ? 0.18 : 0.08);
  const hover = opaqueMapColor(tone, paper, dark ? 0.26 : 0.14);
  const current = opaqueMapColor(tone, paper, dark ? 0.32 : 0.18);
  const surfaces = [fill, hover, current];
  const text = readable(opaqueMapColor(palette.text.primary, fill), surfaces, 4.6, theme);
  const metadata = readable(opaqueMapColor(palette.text.secondary, fill), surfaces, 4.6, theme);
  const boundary = readable(opaqueMapColor(tone, paper), [...surfaces, canvas], 3.1, theme);
  const accent = readable(opaqueMapColor(blue, paper), [...surfaces, canvas], 3.1, theme);
  return { family, canvas, fill, hover, current, text, metadata, boundary, icon: boundary, accent };
}
