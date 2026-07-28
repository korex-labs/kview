// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { apiPostWithContext } from "../../../api";
import { createPodDebugSession } from "../../../sessionsApi";
import PodDebugDialog from "./PodDebugDialog";

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api")>();
  return {
    ...actual,
    apiPostWithContext: vi.fn(),
  };
});

vi.mock("../../../sessionsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../sessionsApi")>();
  return {
    ...actual,
    createPodDebugSession: vi.fn(),
  };
});

const mockedApiPostWithContext = vi.mocked(apiPostWithContext);
const mockedCreatePodDebugSession = vi.mocked(createPodDebugSession);

const baseProps = {
  open: true,
  token: "token",
  contextName: "kind-dev",
  namespace: "default",
  pod: "api-0",
  podUID: "pod-uid",
  containers: [
    { name: "sidecar", state: "Waiting" },
    { name: "app", state: "Running" },
  ],
  defaultImage: "docker.io/library/busybox:1.36",
  defaultShell: "/bin/sh",
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PodDebugDialog", () => {
  it("checks exact subresource permissions and starts a baseline debug session", async () => {
    mockedApiPostWithContext.mockResolvedValue({ allowed: true });
    mockedCreatePodDebugSession.mockResolvedValue({
      sessionID: "sess-debug",
      debugContainer: "kview-debug-a1b2",
    });
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(<PodDebugDialog {...baseProps} onCreated={onCreated} onClose={onClose} />);

    expect(screen.getByText(/cannot remove or change it afterwards/i)).toBeTruthy();
    const startButton = screen.getByRole("button", { name: "Create and open terminal" }) as HTMLButtonElement;
    await waitFor(() => expect(startButton.disabled).toBe(false));

    expect(mockedApiPostWithContext).toHaveBeenCalledTimes(3);
    expect(mockedApiPostWithContext).toHaveBeenCalledWith(
      "/api/auth/can-i",
      "token",
      "kind-dev",
      expect.objectContaining({ verb: "patch", resource: "pods", subresource: "ephemeralcontainers", name: "api-0" }),
    );
    expect(mockedApiPostWithContext).toHaveBeenCalledWith(
      "/api/auth/can-i",
      "token",
      "kind-dev",
      expect.objectContaining({ verb: "create", resource: "pods", subresource: "attach", name: "api-0" }),
    );

    fireEvent.click(startButton);

    await waitFor(() => expect(mockedCreatePodDebugSession).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "default",
        pod: "api-0",
        expectedUID: "pod-uid",
        targetContainer: "app",
        image: "docker.io/library/busybox:1.36",
        shell: "/bin/sh",
        profile: "baseline",
      }),
      "token",
      "kind-dev",
    ));
    expect(onCreated).toHaveBeenCalledWith("sess-debug", "kview-debug-a1b2");
    expect(onClose).toHaveBeenCalled();
  });

  it("fails closed when Kubernetes RBAC denies attach", async () => {
    mockedApiPostWithContext
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, reason: "attach denied" });

    render(<PodDebugDialog {...baseProps} />);

    expect(await screen.findByText("attach denied")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create and open terminal" }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockedCreatePodDebugSession).not.toHaveBeenCalled();
  });
});
