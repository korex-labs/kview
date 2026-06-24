// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActiveContextProvider } from "../../activeContext";
import { RESOURCE_MEMORY_STORAGE_KEY } from "../../resourceMemory";
import { ResourceMemoryPanel } from "./ResourceMemory";

afterEach(() => {
  cleanup();
  localStorage.removeItem(RESOURCE_MEMORY_STORAGE_KEY);
});

describe("ResourceMemoryPanel", () => {
  it("saves local resource memory for the active context", () => {
    render(
      <ActiveContextProvider value="kind-dev">
        <ResourceMemoryPanel resource="pods" namespace="app-prod" name="api-7f" />
      </ActiveContextProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Operator note/ }), { target: { value: "Crash looping after deploy" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Reference link/ }), { target: { value: "https://runbooks.example/api" } });
    fireEvent.click(screen.getByText("Save notes"));

    const raw = localStorage.getItem(RESOURCE_MEMORY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain("kind-dev");
    expect(raw).toContain("Crash looping after deploy");
    expect(screen.getByText("Operator notes")).toBeTruthy();
    expect(screen.getAllByText("Watch item").length).toBeGreaterThan(0);
  });
});
