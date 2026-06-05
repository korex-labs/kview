import { describe, expect, it } from "vitest";
import { aliasesForSection, buildCommandSuggestions, parseKeyboardCommand } from "./commands";

describe("keyboard commands", () => {
  it("parses resource aliases", () => {
    expect(parseKeyboardCommand(":po", [], [])).toEqual({ type: "section", section: "pods" });
    expect(parseKeyboardCommand(">po", [], [])).toEqual({ type: "section", section: "pods" });
    expect(parseKeyboardCommand("deploy", [], [])).toEqual({ type: "section", section: "deployments" });
    expect(aliasesForSection("services")).toContain("svc");
  });

  it("parses namespace and context commands while preserving matched case", () => {
    expect(parseKeyboardCommand(":ns KUBE-System", ["kube-system"], [])).toEqual({
      type: "namespace",
      namespace: "kube-system",
    });
    expect(parseKeyboardCommand(":ctx PROD-East", [], ["prod-east"])).toEqual({
      type: "context",
      context: "prod-east",
    });
  });

  it("builds filtered command suggestions", () => {
    const suggestions = buildCommandSuggestions({
      query: "ctx",
      namespaces: ["default"],
      contexts: ["kind-local"],
    });
    expect(suggestions.some((suggestion) => suggestion.value === ":ctx kind-local")).toBe(true);
    expect(suggestions.some((suggestion) => suggestion.value === ":ns default")).toBe(false);
  });
});
