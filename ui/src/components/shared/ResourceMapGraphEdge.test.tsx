// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Position, type EdgeProps } from "@xyflow/react";
import type { ApiResourceIdentity, ResourceMapEdge } from "../../types/api";
import ResourceMapGraphEdge from "./ResourceMapGraphEdge";
import type { ResourceMapFlowEdge } from "./resourceMapGraphModel";

const getSmoothStepPathMock = vi.hoisted(() => vi.fn(() => ["M0 0 L100 100", 50, 50, 0, 0]));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    BaseEdge: ({ id, path }: { id: string; path: string }) => <svg data-testid={`edge-${id}`} data-path={path} />,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    getSmoothStepPath: getSmoothStepPathMock,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const fromIdentity: ApiResourceIdentity = { group: "", version: "v1", resource: "namespaces", kind: "Namespace", scope: "cluster", name: "prod" };
const toIdentity: ApiResourceIdentity = { group: "apps", version: "v1", resource: "deployments", kind: "Deployment", scope: "namespaced", namespace: "prod", name: "api" };
const resourceEdge: ResourceMapEdge = {
  id: "namespace-edge",
  from: "namespace",
  to: "deployment",
  type: "namespace",
  source: { type: "kubernetes", fieldPath: "metadata.namespace" },
  evidence: { description: "namespace membership", selector: { environment: "production", app: "api" } },
  confidence: "exact",
  resolved: true,
};

describe("ResourceMapGraphEdge", () => {
  it("exposes exact endpoints, source path, evidence, and selector on hover", async () => {
    const props = {
      id: resourceEdge.id,
      source: resourceEdge.from,
      target: resourceEdge.to,
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      selected: false,
      animated: false,
      data: {
        resourceEdge,
        fromIdentity,
        toIdentity,
        stepPosition: 0.38,
        selfLoop: false,
        routePoints: [{ x: 0, y: 0 }, { x: 20, y: 50 }, { x: 80, y: 50 }, { x: 100, y: 100 }],
      },
    } as EdgeProps<ResourceMapFlowEdge>;
    render(<ResourceMapGraphEdge {...props} />);
    expect(screen.getByTestId(`edge-${resourceEdge.id}`).getAttribute("data-path")).toContain(" Q ");
    expect(getSmoothStepPathMock).not.toHaveBeenCalled();
    const label = screen.getByLabelText(/Namespace containment: Namespace prod to Deployment prod\/api, exact confidence, resolved/);
    expect(window.getComputedStyle(label).opacity).toBe("0.45");
    expect(label.textContent).toBe("•");
    fireEvent.mouseOver(label);
    expect(label.textContent).toBe("Namespace containment");
    expect(await screen.findByText("Source field: metadata.namespace")).toBeTruthy();
    expect(screen.getByText("Evidence: namespace membership")).toBeTruthy();
    expect(screen.getByText("Selector: app=api, environment=production")).toBeTruthy();
    fireEvent.mouseOut(label);
    expect(label.textContent).toBe("•");
    fireEvent.focus(label);
    expect(label.textContent).toBe("Namespace containment");
  });

  it("uses an external Bezier route for self-loops", () => {
    const loopEdge = { ...resourceEdge, id: "loop", from: "deployment", to: "deployment" };
    const props = {
      id: loopEdge.id,
      source: loopEdge.from,
      target: loopEdge.to,
      sourceX: 100,
      sourceY: 35,
      targetX: 100,
      targetY: 65,
      sourcePosition: Position.Right,
      targetPosition: Position.Right,
      selected: false,
      animated: false,
      data: { resourceEdge: loopEdge, fromIdentity: toIdentity, toIdentity, stepPosition: 0.5, selfLoop: true, routePoints: [] },
    } as EdgeProps<ResourceMapFlowEdge>;
    render(<ResourceMapGraphEdge {...props} />);
    expect(screen.getByTestId("edge-loop").getAttribute("data-path")).toBe("M 100 35 C 172 35 172 65 100 65");
  });
});
