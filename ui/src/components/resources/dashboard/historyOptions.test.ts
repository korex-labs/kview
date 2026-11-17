import { expect, it } from "vitest";
import { emptyHistoryCatalog, historyOptions, mergeHistoryCatalog, mergeHistoryOptions, parseHistoryCatalog, signalTypeLabel } from "./historyOptions";
it("uses full authoritative catalog labels with readable unknown fallbacks without altering IDs", () => {
  const labels = new Map([["pod_pending", "Pods pending scheduling"]]);
  expect(signalTypeLabel("pod_pending", labels)).toBe("Pods pending scheduling");
  expect(signalTypeLabel("unknown_signal-type", labels)).toBe("Unknown signal type");
  expect(signalTypeLabel("futureRule", labels)).toBe("Future Rule");
  expect([...labels.keys()]).toEqual(["pod_pending"]);
});
const option = (key: string, label = key) => ({ key, label });
it("sorts selected first then label/key and preserves missing identities", () => {
  expect(historyOptions([option("b"), option("a"), option("c")], ["c", "gone"]).map(x => x.key)).toEqual(["c", "gone", "a", "b"]);
  expect(historyOptions([option("b", "same"), option("a", "same")], []).map(x => x.key)).toEqual(["a", "b"]);
});
it("unions retained and current UID identities without guessing or collapsing names", () => {
  const retained = option('["worker","old"]', "worker"), current = option('["worker","new"]', "worker");
  expect(mergeHistoryOptions([retained], [current, retained])).toEqual([retained, current]);
  expect(parseHistoryCatalog({ ...emptyHistoryCatalog(), nodes: [retained, current] }).nodes).toHaveLength(2);
});
it("reports actual combined overflow, not sum of duplicate source lengths", () => {
  const a = { ...emptyHistoryCatalog(), namespaces: Array.from({ length: 4096 }, (_, i) => option(`ns-${i}`)) };
  expect(mergeHistoryCatalog(a, a).truncated).toBe(false);
  const union = mergeHistoryCatalog(a, { ...emptyHistoryCatalog(), namespaces: [option("extra")] });
  expect(union.namespaces).toHaveLength(4096); expect(union.truncated).toBe(true);
  expect(historyOptions(union.namespaces, ["extra"])[0].key).toBe("extra");
});
it.each([null, {}, { ...emptyHistoryCatalog(), nodes: [option("worker")] }, { ...emptyHistoryCatalog(), nodes: [option('["worker",""]')] }, { ...emptyHistoryCatalog(), nodes: [option('[ "worker", "uid" ]')] }, { ...emptyHistoryCatalog(), rules: [option("x"), option("x")] }])("rejects malformed catalogs %j", raw => {
  expect(() => parseHistoryCatalog(raw)).toThrow();
});
