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

  it("keeps featured pages resolvable", () => {
    const pageIds = new Set(helpPages.map((page) => page.id));
    for (const id of helpManifest.featuredPages) {
      expect(pageIds.has(id)).toBe(true);
    }
  });
});
