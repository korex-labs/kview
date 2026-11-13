// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiGet } from "../../api";
import { UserSettingsProvider } from "../../settingsContext";
import ActivityTabs from "./ActivityTabs";
import CodeBlock from "../shared/CodeBlock";

vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiGet: vi.fn() }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../utils/usePageVisible", () => ({ default: () => true }));
vi.mock("../../investigationSnapshots", () => ({ listInvestigationSnapshots: () => Promise.resolve([]) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.resetAllMocks(); });

it("synchronizes runtime rows with other viewers without reloading or resetting the scroll body", async () => {
  vi.useFakeTimers();
  vi.mocked(apiGet).mockImplementation(async (path) => ({ items: path === "/api/activity/runtime/logs" ? [{
    id: "fixture-log", timestamp: "2026-01-01T00:00:00Z", level: "info", source: "fixture-runtime", message: "runtime evidence",
  }] : [] }) as never);
  await act(async () => { render(<UserSettingsProvider>
    <ActivityTabs panelOpen tab={4} token="fixture-token" />
    <CodeBlock code="other viewer" showCopy={false} />
  </UserSettingsProvider>); });
  const message = screen.getByText("runtime evidence");
  const scroll = message.closest(".MuiTableContainer-root")!;
  scroll.scrollTop = 42;
  const calls = vi.mocked(apiGet).mock.calls.length;
  fireEvent.click(screen.getAllByRole("button", { name: "Increase text size" })[1]);
  expect(getComputedStyle(message).fontSize).toBe("14px");
  expect(getComputedStyle(screen.getByText("fixture-runtime")).fontSize).toBe("14px");
  expect(screen.queryByText(/\d+ px/)).toBeNull();
  const overlay = screen.getAllByRole("group", { name: "Text viewer font size" })[0];
  expect(getComputedStyle(overlay).position).toBe("absolute");
  expect(overlay.parentElement).toBe(scroll.parentElement);
  expect(getComputedStyle(scroll).paddingBottom).toBe("52px");
  expect(message.closest(".MuiTableContainer-root")).toBe(scroll);
  expect(scroll.scrollTop).toBe(42);
  expect(apiGet).toHaveBeenCalledTimes(calls);
  expect(scroll.contains(screen.getAllByRole("group", { name: "Text viewer font size" })[0])).toBe(false);
});
