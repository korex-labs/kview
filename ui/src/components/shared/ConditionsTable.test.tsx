// @vitest-environment jsdom

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ConditionsTable, { type Condition } from "./ConditionsTable";

function row(name: string, status: "True" | "False" | "Unknown"): Condition {
  return { type: name, status, reason: `${name}Reason`, message: `${name} message` };
}

describe("ConditionsTable unhealthyFirst ordering", () => {
  it("pins unhealthy rows to the top (section variant, default unhealthyFirst=true)", () => {
    const conditions: Condition[] = [
      row("Ready", "True"),
      row("DiskPressure", "True"), // default isHealthy treats True as healthy
      row("Available", "False"), // unhealthy under default
      row("Progressing", "True"),
    ];

    const { container } = render(<ConditionsTable conditions={conditions} variant="section" />);

    const rows = within(container).getByRole("table").querySelectorAll("tbody tr");
    const typeCells = Array.from(rows).map((r) => r.querySelector("td")?.textContent || "");
    expect(typeCells[0]).toBe("Available");
    expect(typeCells.slice(1)).toEqual(["Ready", "DiskPressure", "Progressing"]);
  });

  it("preserves original order when unhealthyFirst=false", () => {
    const conditions: Condition[] = [
      row("Ready", "True"),
      row("Available", "False"),
      row("Progressing", "True"),
    ];

    const { container } = render(<ConditionsTable conditions={conditions} variant="section" unhealthyFirst={false} />);
    const rows = within(container).getByRole("table").querySelectorAll("tbody tr");
    const typeCells = Array.from(rows).map((r) => r.querySelector("td")?.textContent || "");
    expect(typeCells).toEqual(["Ready", "Available", "Progressing"]);
  });

  it("respects custom isHealthy when ordering", () => {
    const conditions: Condition[] = [
      row("Ready", "True"),
      row("ReplicaFailure", "True"), // healthy by default, but custom treats True as unhealthy
      row("Progressing", "True"),
    ];
    const isHealthy = (c: Condition) =>
      c.type === "ReplicaFailure" ? c.status !== "True" : c.status === "True";

    const { container } = render(
      <ConditionsTable
        conditions={conditions}
        variant="section"
        isHealthy={isHealthy}
      />,
    );

    const rows = within(container).getByRole("table").querySelectorAll("tbody tr");
    const typeCells = Array.from(rows).map((r) => r.querySelector("td")?.textContent || "");
    expect(typeCells[0]).toBe("ReplicaFailure");
  });

  it("shows empty state when there are no conditions", () => {
    render(
      <ConditionsTable
        conditions={[]}
        variant="section"
        emptyMessage="No conditions reported for this PVC."
      />,
    );
    expect(screen.getByText("No conditions reported for this PVC.")).toBeTruthy();
  });
});
