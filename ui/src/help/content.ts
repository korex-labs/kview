import manifest from "../../../docs/user/manifest.json";
import actionsAndSafety from "../../../docs/user/actions-and-safety.md?raw";
import activityPanel from "../../../docs/user/activity-panel.md?raw";
import customCommandsActions from "../../../docs/user/custom-commands-actions.md?raw";
import customResources from "../../../docs/user/custom-resources.md?raw";
import dashboardAndSignals from "../../../docs/user/dashboard-and-signals.md?raw";
import dataplaneSettings from "../../../docs/user/dataplane-settings.md?raw";
import gettingStarted from "../../../docs/user/getting-started.md?raw";
import helm from "../../../docs/user/helm.md?raw";
import importExport from "../../../docs/user/import-export.md?raw";
import namespaces from "../../../docs/user/namespaces.md?raw";
import navigation from "../../../docs/user/navigation.md?raw";
import networking from "../../../docs/user/networking.md?raw";
import policy from "../../../docs/user/policy.md?raw";
import podsWorkloads from "../../../docs/user/pods-workloads.md?raw";
import rbac from "../../../docs/user/rbac.md?raw";
import resourceDrawers from "../../../docs/user/resource-drawers.md?raw";
import resourceLists from "../../../docs/user/resource-lists.md?raw";
import resourceMacrosDynamicLinks from "../../../docs/user/resource-macros-dynamic-links.md?raw";
import resourceTags from "../../../docs/user/resource-tags.md?raw";
import settings from "../../../docs/user/settings.md?raw";
import smartFilters from "../../../docs/user/smart-filters.md?raw";
import storage from "../../../docs/user/storage.md?raw";
import troubleshooting from "../../../docs/user/troubleshooting.md?raw";
import viewsAndResources from "../../../docs/user/views-and-resources.md?raw";
import whatsNew from "../../../docs/user/whats-new.md?raw";
import workflows from "../../../docs/user/workflows.md?raw";

export type HelpSurface = "app" | "repo" | "website";

export type HelpPageMeta = {
  id: string;
  title: string;
  category: string;
  source: string;
  surfaces: HelpSurface[];
};

export type HelpManifest = {
  version: number;
  title: string;
  externalLinks: {
    github: string;
    website: string;
    patreon: string;
  };
  pages: HelpPageMeta[];
  featuredPages: string[];
};

export type HelpPage = HelpPageMeta & {
  body: string;
};

const pageBodies: Record<string, string> = {
  "actions-and-safety": actionsAndSafety,
  "activity-panel": activityPanel,
  "custom-commands-actions": customCommandsActions,
  "custom-resources": customResources,
  "dashboard-and-signals": dashboardAndSignals,
  "dataplane-settings": dataplaneSettings,
  "getting-started": gettingStarted,
  helm,
  "import-export": importExport,
  namespaces,
  navigation,
  networking,
  policy,
  "pods-workloads": podsWorkloads,
  rbac,
  "resource-drawers": resourceDrawers,
  "resource-lists": resourceLists,
  "resource-macros-dynamic-links": resourceMacrosDynamicLinks,
  "resource-tags": resourceTags,
  settings,
  "smart-filters": smartFilters,
  storage,
  troubleshooting,
  "views-and-resources": viewsAndResources,
  "whats-new": whatsNew,
  workflows,
};

export const helpManifest = manifest as HelpManifest;

export const helpPages: HelpPage[] = helpManifest.pages
  .filter((page) => page.surfaces.includes("app"))
  .map((page) => ({
    ...page,
    body: pageBodies[page.id] || "",
  }));

export const featuredHelpPages = helpManifest.featuredPages
  .map((id) => helpPages.find((page) => page.id === id))
  .filter((page): page is HelpPage => Boolean(page));

export function helpPagesByCategory(pages: HelpPage[]): Array<{ category: string; pages: HelpPage[] }> {
  const groups: Array<{ category: string; pages: HelpPage[] }> = [];
  for (const page of pages) {
    let group = groups.find((item) => item.category === page.category);
    if (!group) {
      group = { category: page.category, pages: [] };
      groups.push(group);
    }
    group.pages.push(page);
  }
  return groups;
}
