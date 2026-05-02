import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

type DrawerCase = {
  name: string;
  relPath: string;
  overviewAnchor: string;
  dynamicHelmTabs?: boolean;
};

const DRAWERS: DrawerCase[] = [
  { name: "Pod", relPath: "pods/PodDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Deployment", relPath: "deployments/DeploymentDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "StatefulSet", relPath: "statefulsets/StatefulSetDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "DaemonSet", relPath: "daemonsets/DaemonSetDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "ReplicaSet", relPath: "replicasets/ReplicaSetDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Job", relPath: "jobs/JobDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "CronJob", relPath: "cronjobs/CronJobDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Service", relPath: "services/ServiceDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Ingress", relPath: "ingresses/IngressDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "PVC", relPath: "persistentvolumeclaims/PersistentVolumeClaimDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "PV", relPath: "persistentvolumes/PersistentVolumeDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "ConfigMap", relPath: "configmaps/ConfigMapDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Secret", relPath: "secrets/SecretDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "ServiceAccount", relPath: "serviceaccounts/ServiceAccountDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "Role", relPath: "roles/RoleDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "RoleBinding", relPath: "rolebindings/RoleBindingDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "ClusterRole", relPath: "clusterroles/ClusterRoleDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "ClusterRoleBinding", relPath: "clusterrolebindings/ClusterRoleBindingDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "HelmRelease", relPath: "helm/HelmReleaseDrawer.tsx", overviewAnchor: 'activeTabId === "overview"', dynamicHelmTabs: true },
  { name: "Node", relPath: "nodes/NodeDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
  { name: "CRD", relPath: "customresourcedefinitions/CustomResourceDefinitionDrawer.tsx", overviewAnchor: "{tab === 0 && (" },
];

const RESOURCES_DIR = path.resolve(process.cwd(), "src/components/resources");

function extractTabs(src: string, dynamicHelmTabs = false): string[] {
  if (dynamicHelmTabs) {
    const labels = [...src.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
    // Keep first occurrence ordering and unique values.
    return Array.from(new Set(labels));
  }
  return [...src.matchAll(/<Tab\b[^>]*\blabel="([^"]+)"/g)].map((m) => m[1]);
}

function extractOverviewSlice(src: string, anchor: string): string {
  const idx = src.indexOf(anchor);
  if (idx < 0) return "";
  const tail = src.slice(idx);
  const marker = /\{tab === \d+ && \(|\{activeTabId === "(\w+)"/g;
  const matches = Array.from(tail.matchAll(marker)).map((m) => m.index ?? -1).filter((n) => n >= 0);
  if (matches.length <= 1) return tail;
  return tail.slice(0, matches[1]);
}

function extractOverviewStructure(src: string, anchor: string) {
  const overview = extractOverviewSlice(src, anchor);
  return {
    hasAttentionSummary: overview.includes("<AttentionSummary"),
    sections: [...overview.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]),
  };
}

describe("drawer layout order snapshots", () => {
  it("locks tab order and overview section order for migrated drawers", () => {
    const snapshotData = DRAWERS.map((drawer) => {
      const absPath = path.join(RESOURCES_DIR, drawer.relPath);
      const src = fs.readFileSync(absPath, "utf8");
      return {
        drawer: drawer.name,
        path: drawer.relPath,
        tabs: extractTabs(src, drawer.dynamicHelmTabs),
        overview: extractOverviewStructure(src, drawer.overviewAnchor),
      };
    });
    expect(snapshotData).toMatchSnapshot();
  });
});
