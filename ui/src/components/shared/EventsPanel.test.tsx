// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventsPanel from "./EventsPanel";
const api = vi.hoisted(() => ({ legacy: vi.fn(), exact: vi.fn() }));
vi.mock("../../api", () => ({ apiGet: api.legacy, apiGetWithContext: api.exact, toApiError: (e: Error) => ({ message: e.message }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const event = (message: string) => ({ message, type: "Normal", reason: "Synced" });
const response = (message: string) => ({ items: [event(message)], total: 100, limit: 2, hasMore: true });
describe("EventsPanel", () => {
  it("merges identity and severity filters with pagination and query without duplicate parameters", async () => {
    api.exact.mockResolvedValue(response("visible event"));
    render(<EventsPanel endpoint="/api/cr/events?namespace=a%2Fb&uid=u%26v&severity=warning&limit=9&offset=17" token="token" contextName="alpha" pageSize={2} />);
    await screen.findByText("visible event");
    const params = () => new URL(api.exact.mock.lastCall![0], "http://test").searchParams;
    expect(params().get("namespace")).toBe("a/b");
    expect(params().get("uid")).toBe("u&v");
    expect(params().has("expectedUID")).toBe(false);
    expect(params().get("severity")).toBe("warning");
    expect(params().getAll("limit")).toEqual(["2"]);
    expect(params().getAll("offset")).toEqual(["0"]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(params().get("offset")).toBe("2"));
    fireEvent.change(screen.getByPlaceholderText("Filter events"), { target: { value: " Need Help " } });
    await waitFor(() => expect(params().get("q")).toBe("need help"));
    expect(params().get("offset")).toBe("0");
    expect(params().get("severity")).toBe("warning");
    expect(params().get("uid")).toBe("u&v");
    fireEvent.change(screen.getByPlaceholderText("Filter events"), { target: { value: "" } });
    await waitFor(() => expect(params().has("q")).toBe(false));
    expect(params().get("offset")).toBe("0");
    expect(api.legacy).not.toHaveBeenCalled();
    expect(api.exact.mock.lastCall![2]).toBe("alpha");
  });
  it.each(["success", "failure"])("hides old identity results and ignores late %s after context/token/endpoint changes", async (completion) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    api.exact.mockResolvedValueOnce(response("old event"))
      .mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }))
      .mockResolvedValue(response("current event"));
    const view = render(<EventsPanel endpoint="/events?uid=old" token="one" contextName="alpha" pageSize={2} />);
    await screen.findByText("old event");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.exact).toHaveBeenCalledTimes(2));
    const signal = api.exact.mock.calls[1][3].signal;
    view.rerender(<EventsPanel endpoint="/events?uid=new" token="two" contextName="beta" pageSize={2} />);
    expect(screen.queryByText("old event")).toBeNull();
    await screen.findByText("current event");
    expect(signal.aborted).toBe(true);
    expect(new URL(api.exact.mock.calls[2][0], "http://test").searchParams.get("offset")).toBe("0");
    expect(api.exact.mock.calls[2].slice(1, 3)).toEqual(["two", "beta"]);
    await act(async () => completion === "success" ? resolve(response("obsolete event")) : reject(new Error("obsolete failure")));
    expect(screen.queryByText(/obsolete/)).toBeNull();
    expect(screen.getByText("current event")).toBeTruthy();
  });
  it.each(["context", "token", "endpoint"])("cancels pending Events when %s alone changes and on unmount", async (field) => {
    let complete!: (value: unknown) => void;
    api.exact.mockImplementationOnce(() => new Promise((done) => { complete = done; }))
      .mockResolvedValue(response("current event"));
    const props = { endpoint: "/events?uid=original", token: "one", contextName: "alpha" };
    const view = render(<EventsPanel {...props} />);
    const oldSignal = api.exact.mock.calls[0][3].signal;
    view.rerender(<EventsPanel {...props}
      {...(field === "context" ? { contextName: "beta" } : field === "token" ? { token: "two" } : { endpoint: "/events?uid=new" })} />);
    await screen.findByText("current event");
    expect(oldSignal.aborted).toBe(true);
    await act(async () => complete(response("obsolete event")));
    expect(screen.queryByText("obsolete event")).toBeNull();
    const currentSignal = api.exact.mock.calls[1][3].signal;
    view.unmount();
    expect(currentSignal.aborted).toBe(true);
  });
  it("keeps legacy ambient callers and local filtering working", async () => {
    api.legacy.mockResolvedValue(response("legacy event"));
    const view = render(<EventsPanel endpoint="/events" token="token" />);
    await screen.findByText("legacy event");
    expect(api.legacy.mock.lastCall![0]).toBe("/events?limit=50&offset=0");
    expect(api.exact).not.toHaveBeenCalled();
    view.rerender(<EventsPanel events={[event("first"), event("second")]} />);
    fireEvent.change(screen.getByPlaceholderText("Filter events"), { target: { value: "second" } });
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();
  });
  it("retries an Events error independently in the same exact context", async () => {
    api.exact.mockRejectedValueOnce(new Error("Events unavailable"))
      .mockResolvedValue(response("recovered event"));
    render(<EventsPanel endpoint="/events?uid=original" token="token" contextName="alpha" />);
    await screen.findByText("Events unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry events" }));
    await screen.findByText("recovered event");
    expect(api.exact.mock.calls[1].slice(0, 3)).toEqual(api.exact.mock.calls[0].slice(0, 3));
  });
  it("shows an error rather than empty events and forbids an empty explicit context", async () => {
    render(<EventsPanel endpoint="/events" token="token" contextName="" />);
    await screen.findByText("Missing active context");
    expect(screen.queryByText("No events found.")).toBeNull();
    expect(api.legacy).not.toHaveBeenCalled();
    expect(api.exact).not.toHaveBeenCalled();
  });
});
