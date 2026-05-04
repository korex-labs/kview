import { describe, expect, it } from "vitest";
import { fetchClusterResourceDetailWithWarnings, fetchNamespacedResourceDetailWithWarnings } from "./resourceDrawerFetch";

describe("resource drawer fetch helpers", () => {
  it("fetches detail and warning events in parallel with encoded paths", async () => {
    const calls: string[] = [];
    const apiGetFn = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (path.endsWith("/events?limit=5&type=Warning")) {
        return {
          items: [{ type: "Warning", reason: "BackOff", message: "retrying", count: 2, firstSeen: 1, lastSeen: 2 }],
        } as T;
      }
      return {
        item: { name: "api" },
        detailSignals: [{ signalType: "pod_restart", severity: "warning" }],
      } as T;
    };

    const result = await fetchNamespacedResourceDetailWithWarnings<{ name: string }>({
      token: "token",
      namespace: "team/a",
      resource: "pods",
      name: "api 0",
      apiGetFn,
    });

    expect(calls).toEqual([
      "/api/namespaces/team%2Fa/pods/api%200",
      "/api/namespaces/team%2Fa/pods/api%200/events?limit=5&type=Warning",
    ]);
    expect(result.item).toEqual({ name: "api" });
    expect(result.detailSignals).toHaveLength(1);
    expect(result.warningEvents).toHaveLength(1);
  });

  it("normalizes absent optional arrays", async () => {
    const responses: unknown[] = [{ item: { name: "api" } }, {}];
    const apiGetFn = async <T>(): Promise<T> => responses.shift() as T;

    const result = await fetchNamespacedResourceDetailWithWarnings<{ name: string }>({
      token: "token",
      namespace: "default",
      resource: "jobs",
      name: "api",
      apiGetFn,
    });

    expect(result.detailSignals).toEqual([]);
    expect(result.warningEvents).toEqual([]);
  });

  it("fetches cluster-scoped details with encoded paths", async () => {
    const calls: string[] = [];
    const apiGetFn = async <T>(path: string): Promise<T> => {
      calls.push(path);
      return path.endsWith("/events?limit=5&type=Warning")
        ? ({ items: [] } as T)
        : ({ item: { name: "reader/admin" } } as T);
    };

    const result = await fetchClusterResourceDetailWithWarnings<{ name: string }>({
      token: "token",
      resource: "clusterroles",
      name: "reader/admin",
      apiGetFn,
    });

    expect(calls).toEqual([
      "/api/clusterroles/reader%2Fadmin",
      "/api/clusterroles/reader%2Fadmin/events?limit=5&type=Warning",
    ]);
    expect(result.item).toEqual({ name: "reader/admin" });
  });
});
