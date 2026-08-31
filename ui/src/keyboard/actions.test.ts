import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { actionDefinitions, actionDefinitionById, drawerTabActionIdByLabel, drawerTabActions } from "./actions";
import { sections } from "../state";

const knownDrawerTabLabels = [
  "resource map", "notes", "overview", "signals", "containers", "resources", "networking", "events", "logs", "metadata",
  "yaml", "pods", "spec", "keys", "rules", "tls", "versions", "namespaces", "conditions", "inventory",
  "capacity", "subjects", "role bindings", "role ref", "jobs", "values", "manifest", "hooks", "history",
];

describe("keyboard action registry", () => {
  it("gives every resource drawer Tab a semantic keyboard action marker", () => {
    const root = fileURLToPath(new URL("../components/resources", import.meta.url));
    const drawerFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.name.endsWith("Drawer.tsx")) drawerFiles.push(absolute);
      }
    };
    visit(root);

    const missing = drawerFiles.flatMap((file) => readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => ({ file: path.relative(root, file), line: index + 1, source: line.trim() }))
      .filter(({ source }) => source.includes("<Tab "))
      .filter(({ source }) => !source.includes("data-keyboard-action-id=") && !source.includes("drawerTabProps(")));
    expect(missing).toEqual([]);
  });
  it("has unique stable IDs and safety metadata", () => {
    expect(new Set(actionDefinitions.map((action) => action.id)).size).toBe(actionDefinitions.length);
    expect(actionDefinitionById.get("nav.pods")).toMatchObject({
      label: "Go to Pods",
      group: "Navigation",
      scopes: ["app"],
      safety: "safe",
      section: "pods",
    });
  });

  it("keeps definitions separate from preset bindings", () => {
    expect(actionDefinitionById.get("search.focus")).not.toHaveProperty("bindings");
  });

  it("covers every application section exactly once", () => {
    const navigationSections = actionDefinitions.flatMap((action) => action.section ? [action.section] : []);
    expect(navigationSections).toHaveLength(sections.length);
    expect(new Set(navigationSections)).toEqual(new Set(sections));
  });

  it("uses one stable registered action for every discoverable drawer tab", () => {
    expect(new Set(drawerTabActions.map(([label]) => label))).toEqual(new Set(knownDrawerTabLabels));
    expect(drawerTabActionIdByLabel.size).toBe(drawerTabActions.length);
    for (const [label, slug] of drawerTabActions) {
      expect(drawerTabActionIdByLabel.get(label)).toBe(`drawer.tab.${slug}`);
      expect(actionDefinitionById.get(`drawer.tab.${slug}` as never)).toMatchObject({ group: "Drawer", scopes: ["drawer"] });
    }
  });
});
