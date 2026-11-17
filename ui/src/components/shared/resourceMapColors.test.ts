import { createTheme, getContrastRatio } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import type { ResourceIconName } from "../icons/resources/types";
import { opaqueMapColor, resourceMapColors, resourceMapFamily } from "./resourceMapColors";

const representatives: ResourceIconName[] = ["deployments", "pods", "services", "persistentvolumeclaims", "secrets", "serviceaccounts", "nodes", "customresources"];

describe("resource map palette", () => {
  it("uses stable bounded semantic families and a neutral custom/product fallback", () => {
    expect(representatives.map(resourceMapFamily)).toEqual(["workload", "pod", "network", "storage", "config", "access", "cluster", "unknown"]);
    expect(resourceMapFamily("replicasets")).toBe(resourceMapFamily("deployments"));
    expect(resourceMapFamily("configmaps")).toBe(resourceMapFamily("secrets"));
    expect(resourceMapFamily("clusterroles")).toBe(resourceMapFamily("roles"));
    expect(resourceMapFamily("helmcharts")).toBe("unknown");
    expect(resourceMapFamily("customresourcedefinitions")).toBe("unknown");
  });

  for (const mode of ["light", "dark"] as const) {
    for (const icon of representatives) {
      it(`${mode} ${icon}: opaque normal/current/hover fills and readable text, metadata, icons and boundaries`, () => {
        // These are the application's actual palette options (no global override).
        const theme = createTheme({ palette: { mode } });
        expect(theme.palette.background.paper).toBe(theme.palette.background.default);
        const colors = resourceMapColors(theme, icon);
        expect(colors).toEqual(resourceMapColors(theme, icon));
        expect(new Set([colors.fill, colors.hover, colors.current, colors.canvas]).size).toBe(4);
        for (const fill of [colors.fill, colors.hover, colors.current]) {
          expect(fill).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
          for (const text of [colors.text, colors.metadata]) expect(getContrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
          for (const essential of [colors.icon, colors.boundary, colors.accent]) {
            expect(getContrastRatio(essential, fill)).toBeGreaterThanOrEqual(3);
            expect(getContrastRatio(essential, colors.canvas)).toBeGreaterThanOrEqual(3);
          }
        }
        expect(getContrastRatio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(colors.boundary).not.toBe(theme.palette.error.main);
        expect(colors.boundary).not.toBe(theme.palette.warning.main);
      });
    }
  }

  it("composites alpha into opaque RGB rather than passing transparency through", () => {
    expect(opaqueMapColor("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("rgb(128, 128, 128)");
  });
});
