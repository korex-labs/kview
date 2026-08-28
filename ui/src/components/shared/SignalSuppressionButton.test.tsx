// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiDelete, apiPost } from "../../api";
import { SIGNAL_SUPPRESSIONS_CHANGED_EVENT } from "../../signalSuppressions";
import type { DashboardSignalItem } from "../../types/api";
import SignalSuppressionButton from "./SignalSuppressionButton";
import { signalWithHistoryKey } from "./signalIdentity";

vi.mock("../../api", () => ({
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

const fingerprint = `v1:${"a".repeat(64)}`;
const signal: DashboardSignalItem = {
  kind: "Pod",
  namespace: "apps",
  name: "api-0",
  severity: "high",
  score: 10,
  reason: "Container is restarting",
  historyKey: "pod-restarts|apps|api-0",
  stateFingerprint: fingerprint,
};

function renderButton(overrides: Partial<DashboardSignalItem> = {}, onChanged = vi.fn()) {
  render(<SignalSuppressionButton token="token" signal={{ ...signal, ...overrides }} onChanged={onChanged} />);
  return onChanged;
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Suppress signal" }));
}

beforeEach(() => {
  vi.mocked(apiPost).mockResolvedValue(undefined);
  vi.mocked(apiDelete).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignalSuppressionButton", () => {
  it.each([
    ["Snooze 1 hour", { historyKey: signal.historyKey, mode: "snooze", durationSeconds: 3600, comment: "operator note" }],
    ["Snooze 1 day", { historyKey: signal.historyKey, mode: "snooze", durationSeconds: 86400, comment: "operator note" }],
    ["Ignore until changed", { historyKey: signal.historyKey, mode: "until_changed", baselineFingerprint: fingerprint, comment: "operator note" }],
  ])("posts the exact %s payload with a trimmed comment", async (label, payload) => {
    renderButton();
    openMenu();
    fireEvent.change(screen.getByRole("textbox", { name: "Comment (optional)" }), {
      target: { value: "  operator note  " },
    });
    fireEvent.click(screen.getByRole("menuitem", { name: label }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith("/api/dataplane/signals/suppress", "token", payload);
  });

  it("exposes accessible menu labels and disables until-changed without a valid fingerprint", () => {
    renderButton({ stateFingerprint: undefined });
    openMenu();

    expect(screen.getByRole("menuitem", { name: "Snooze 1 hour" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Snooze 1 day" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Ignore until changed" }).getAttribute("aria-disabled")).toBe("true");
  });

  it.each([
    ["uppercase", `v1:${"A".repeat(64)}`],
    ["surrounding whitespace", ` ${fingerprint} `],
  ])("disables until-changed for a %s non-strict fingerprint", (_label, stateFingerprint) => {
    renderButton({ stateFingerprint });
    openMenu();

    expect(screen.getByRole("menuitem", { name: "Ignore until changed" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("renders no mutation control or API path for a synthesized history key", () => {
    const detailOnlySignal = signalWithHistoryKey({
      ...signal,
      historyKey: undefined,
      stateFingerprint: fingerprint,
    });

    render(<SignalSuppressionButton token="token" signal={detailOnlySignal} />);

    expect(detailOnlySignal.clientSynthesizedHistoryKey).toBe(true);
    expect(screen.queryByRole("button", { name: "Suppress signal" })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it("deletes an active suppression with the exact payload and exposes its metadata", async () => {
    renderButton({ suppression: { mode: "until_changed", comment: "known rollout" } });

    const button = screen.getByRole("button", { name: /Show signal now\. Ignored until changed\. Comment: known rollout/ });
    fireEvent.click(button);

    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    expect(apiDelete).toHaveBeenCalledWith("/api/dataplane/signals/suppress", "token", {
      historyKey: signal.historyKey,
    });
  });

  it("dispatches the global invalidation event and callback after success", async () => {
    const changed = vi.fn();
    const listener = vi.fn();
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
    renderButton({}, changed);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Snooze 1 hour" }));

    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
  });

  it("shows a compact error and does not callback or dispatch on failure", async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error("suppression unavailable"));
    const changed = vi.fn();
    const listener = vi.fn();
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
    renderButton({}, changed);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Snooze 1 day" }));

    expect((await screen.findByRole("alert")).textContent).toContain("suppression unavailable");
    expect(changed).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, listener);
  });

  it("prevents duplicate requests while a mutation is busy", async () => {
    let resolveRequest: (() => void) | undefined;
    vi.mocked(apiPost).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    renderButton();
    openMenu();
    const action = screen.getByRole("menuitem", { name: "Snooze 1 hour" });
    fireEvent.click(action);
    fireEvent.click(action);

    expect(apiPost).toHaveBeenCalledTimes(1);
    resolveRequest?.();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
