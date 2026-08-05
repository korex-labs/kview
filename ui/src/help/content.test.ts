import { describe, expect, it } from "vitest";
import { helpManifest, helpPages } from "./content";

describe("help content", () => {
  it("has app pages with embedded markdown bodies", () => {
    expect(helpPages.length).toBeGreaterThan(0);
    for (const page of helpPages) {
      expect(page.id).toBeTruthy();
      expect(page.title).toBeTruthy();
      expect(page.body.trim()).toMatch(/^#/);
    }
  });

  it("provides the matching bundled body for every app manifest page in manifest order", () => {
    const appPageIds = helpManifest.pages
      .filter((page) => page.surfaces.includes("app"))
      .map((page) => page.id);

    expect(helpPages.map((page) => page.id)).toEqual(appPageIds);
    for (const page of helpPages) {
      const firstHeading = page.body.split("\n").find((line) => line.startsWith("# "));
      expect(firstHeading, `${page.id} has the wrong bundled Help body`).toBe(`# ${page.title}`);
    }
  });

  it("keeps featured pages resolvable", () => {
    const pageIds = new Set(helpPages.map((page) => page.id));
    for (const id of helpManifest.featuredPages) {
      expect(pageIds.has(id)).toBe(true);
    }
  });
});
