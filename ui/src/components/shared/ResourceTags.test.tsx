// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResourceTagsRow } from "./ResourceTags";
import type { ResolvedResourceTag } from "../../resourceTags";

function tag(id: string, name: string, inherited = false): ResolvedResourceTag {
  return { id, name, color: "#1976d2", inherited };
}

describe("ResourceTagsRow", () => {
  it("shows an overflow chip when not all tags are visible", () => {
    render(<ResourceTagsRow tags={[tag("a", "Alpha"), tag("b", "Beta"), tag("c", "Gamma", true)]} maxVisible={2} />);

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
  });
});
