// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PodContainersTab, { type PodContainersTabProps } from "./PodContainersTab";
import type { PodContainer } from "./podDetailsTypes";

function container(overrides: Partial<PodContainer> = {}): PodContainer {
  return {
    name: "app",
    image: "example/app:1",
    ready: true,
    state: "Running",
    restartCount: 0,
    resources: {},
    env: [],
    mounts: [],
    probes: {},
    securityContext: { name: "app" },
    ...overrides,
  };
}

function props(overrides: Partial<PodContainersTabProps> = {}): PodContainersTabProps {
  return {
    containers: [],
    ephemeralContainers: [],
    metricsUsable: false,
    offline: false,
    creatingTerminal: false,
    runningCommand: false,
    matchingCommandCounts: {},
    envQueryByContainer: {},
    envShowRefsByContainer: {},
    envPrettyByContainer: {},
    onContainerRef: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenCommands: vi.fn(),
    onEnvQueryChange: vi.fn(),
    onEnvShowRefsChange: vi.fn(),
    onEnvPrettyChange: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PodContainersTab", () => {
  it("shows the empty state without containers", () => {
    render(<PodContainersTab {...props()} />);

    expect(screen.getByText("No containers found for this Pod.")).toBeTruthy();
  });

  it("enables actions only for running containers and forwards the exact container name", () => {
    const onOpenTerminal = vi.fn();
    const onOpenCommands = vi.fn();
    const runningProps = props({
      containers: [container({ name: "api" })],
      matchingCommandCounts: { api: 1 },
      onOpenTerminal,
      onOpenCommands,
    });
    const { rerender } = render(<PodContainersTab {...runningProps} />);

    const terminal = screen.getByRole("button", { name: "Terminal" }) as HTMLButtonElement;
    const commands = screen.getByRole("button", { name: "Commands" }) as HTMLButtonElement;
    expect(terminal.disabled).toBe(false);
    expect(commands.disabled).toBe(false);
    fireEvent.click(terminal);
    fireEvent.click(commands);
    expect(onOpenTerminal).toHaveBeenCalledWith("api");
    expect(onOpenCommands).toHaveBeenCalledWith("api", commands);

    rerender(
      <PodContainersTab
        {...runningProps}
        containers={[container({ name: "api", ready: false, state: "Waiting" })]}
      />,
    );
    expect((screen.getByRole("button", { name: "Terminal" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Commands" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preserves controlled environment filtering, references, and display toggles", () => {
    const onEnvQueryChange = vi.fn();
    const onEnvShowRefsChange = vi.fn();
    const onEnvPrettyChange = vi.fn();
    render(
      <PodContainersTab
        {...props({
          containers: [
            container({
              env: [
                { name: "APP_MODE", value: "debug", source: "Value" },
                { name: "TOKEN", source: "Secret", sourceRef: "secret:token", optional: true },
              ],
            }),
          ],
          envQueryByContainer: { app: "token" },
          envShowRefsByContainer: { app: true },
          envPrettyByContainer: { app: false },
          onEnvQueryChange,
          onEnvShowRefsChange,
          onEnvPrettyChange,
        })}
      />,
    );

    expect(screen.queryByText("APP_MODE")).toBeNull();
    expect(screen.getByText("TOKEN")).toBeTruthy();
    expect(screen.getByText("secret:token")).toBeTruthy();
    expect(screen.getByText("Secret (optional)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Environment 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), { target: { value: "app" } });
    fireEvent.click(screen.getByRole("switch", { name: "Show environment source references" }));
    fireEvent.click(screen.getByRole("switch", { name: "Pretty environment values" }));
    expect(onEnvQueryChange).toHaveBeenCalledWith("app", "app");
    expect(onEnvShowRefsChange).toHaveBeenCalledWith("app", false);
    expect(onEnvPrettyChange).toHaveBeenCalledWith("app", true);
  });

  it("shows usage only when metrics are usable", () => {
    const usageContainer = container({
      usage: {
        cpuMilli: 125,
        memoryBytes: 64 * 1024 * 1024,
        cpuPctLimit: 25,
        memoryPctRequest: 50,
      },
    });
    const base = props({ containers: [usageContainer] });
    const { rerender } = render(<PodContainersTab {...base} />);

    expect(screen.queryByText("Usage")).toBeNull();
    rerender(<PodContainersTab {...base} metricsUsable />);
    expect(screen.getByText("Usage")).toBeTruthy();
    expect(screen.getByText(/125m/)).toBeTruthy();
  });

  it("renders immutable ephemeral-container state details", () => {
    render(
      <PodContainersTab
        {...props({
          ephemeralContainers: [
            {
              name: "debugger",
              image: "example/debug:1",
              targetContainer: "app",
              state: "Terminated",
              reason: "Completed",
              exitCode: 7,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Ephemeral Containers")).toBeTruthy();
    expect(screen.getByText("debugger")).toBeTruthy();
    expect(screen.getByText("Ephemeral")).toBeTruthy();
    expect(screen.getByText("Target Container")).toBeTruthy();
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.getByText("Exit Code")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText(/cannot be removed or changed/)).toBeTruthy();
  });
});
