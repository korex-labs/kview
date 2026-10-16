import { describe, expect, it } from "vitest";
import { parseSearchFilters, removeSearchFilter, tokenizeSearchDraft } from "./searchQuery";
import { searchResultMapIdentity } from "./searchNavigation";

describe("search filter chips", () => {
  it("commits only delimited tokens during continuous edits and the last token on blur", () => {
    for (const draft of ["kind:p", "kind:pod", "kind:pods", "kind:ingress"]) {
      expect(tokenizeSearchDraft(draft)).toEqual({ tokens: [], draft });
    }
    expect(tokenizeSearchDraft("kind:pods ")).toEqual({ tokens: ["kind:pods"], draft: " " });
    expect(tokenizeSearchDraft("kind:ingress", true)).toEqual({ tokens: ["kind:ingress"], draft: "" });
    expect(tokenizeSearchDraft('raw  status:"Not Ready" kind:bogus ')).toEqual({ tokens: ['status:"Not Ready"'], draft: 'raw   kind:bogus ' });
    expect(tokenizeSearchDraft('status:"Not Ready')).toEqual({ tokens: [], draft: 'status:"Not Ready' });
  });
  it("recognizes supported keys and case-insensitive boolean/kind values", () => {
    const query = "kind:Pod ns:Prod namespace:apps name:api cluster:Dev context:dev health:degraded status:Pending signal:high attention:TRUE";
    expect(parseSearchFilters(query).map(({ raw }) => raw)).toEqual(query.split(" "));
  });
  it("recognizes whole quoted filter values and preserves display spelling", () => {
    expect(parseSearchFilters('status:"Not Ready" name:"two words" kind:"Pod" attention:"TRUE"').map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "status", value: "Not Ready" }, { key: "name", value: "two words" },
      { key: "kind", value: "Pod" }, { key: "attention", value: "TRUE" },
    ]);
    expect(parseSearchFilters('name:" api "')[0].value).toBe(" api ");
  });
  it("leaves unknown, malformed and invalid filters as literal text", () => {
    expect(parseSearchFilters('free note:hi stale:true service:api kind:bogus attention:maybe name: name:"" name:"  "')).toEqual([]);
    expect(parseSearchFilters(": name:api")).toEqual([]);
    expect(parseSearchFilters(" > kind:pods")).toEqual([]);
    expect(parseSearchFilters('\u0085> status:"Not Ready"')).toEqual([]);
  });
  it.each([
    'status:"Not Ready"suffix', 'status:"Not Ready"suffix"', 'status:Not"Ready',
    'status:"Not Ready', 'unknown:"Not Ready', 'name:""', 'name:"\t\u0085"',
    'kind:"not pods"', 'attention:" true "', String.raw`name:api\\server`,
    String.raw`status:"Not\\Ready"`,
  ])("does not chip invalid token %s", (query) => {
    expect(parseSearchFilters(query)).toEqual([]);
  });
  it("consumes malformed quoted tokens without exposing filters inside them", () => {
    expect(parseSearchFilters('kind:pods status:"Not Ready name:api ns:prod').map(({ raw }) => raw)).toEqual(["kind:pods"]);
    expect(parseSearchFilters('unknown:"name:api ns:prod" name:ok').map(({ raw }) => raw)).toEqual(["name:ok"]);
    expect(parseSearchFilters('status:"Not Ready"name:api ns:prod').map(({ raw }) => raw)).toEqual(["ns:prod"]);
    // Backslash does not escape the next quote; ns:prod is a separate valid token.
    expect(parseSearchFilters(String.raw`status:"Not\" ns:prod`).map(({ raw }) => raw)).toEqual(["ns:prod"]);
    // Quotes around ordinary text do not group terms.
    expect(parseSearchFilters('"plain name:api words"').map(({ raw }) => raw)).toEqual(["name:api"]);
  });
  it("uses Go Unicode whitespace rather than JavaScript whitespace", () => {
    expect(parseSearchFilters('\u0085name:api\u00a0ns:prod\u2003kind:Pod\u0085').map(({ raw }) => raw)).toEqual(["name:api", "ns:prod", "kind:Pod"]);
    expect(parseSearchFilters('\ufeffname:api')).toEqual([]);
    expect(parseSearchFilters('name:api\ufeffns:prod')[0].value).toBe('api\ufeffns:prod');
  });
  it("removes just the selected occurrence without rewriting other query bytes", () => {
    const query = "  kind:Pod\tapi  ns:prod ns:prod  ";
    const filters = parseSearchFilters(query);
    expect(removeSearchFilter(query, filters[1])).toBe("  kind:Pod\tapi   ns:prod  ");
    expect(removeSearchFilter("changed", filters[1])).toBe("changed");
  });
  it("removes quoted occurrences with UTF-16 spans without rewriting Unicode or whitespace", () => {
    const query = ' 😀\tstatus:"Not Ready"  status:"Not Ready"\u0085name:café ';
    const filters = parseSearchFilters(query);
    expect(filters[0].start).toBe(query.indexOf('status:'));
    expect(query.slice(filters[1].start, filters[1].end)).toBe('status:"Not Ready"');
    expect(removeSearchFilter(query, filters[1])).toBe(' 😀\tstatus:"Not Ready"  \u0085name:café ');
  });
  it("reflects the 4096 UTF-8 byte boundary after Go whitespace trimming", () => {
    const exact = "name:" + "é".repeat(2045) + "a";
    expect(parseSearchFilters("\u0085 " + exact + "\u2003")).toHaveLength(1);
    expect(parseSearchFilters(exact + "a")).toEqual([]);
    expect(parseSearchFilters("name:" + "a".repeat(4091))).toHaveLength(1);
    expect(parseSearchFilters("name:" + "a".repeat(4092))).toEqual([]);
    expect(parseSearchFilters("name:" + "😀".repeat(1023))).toEqual([]);
  });
  it("counts scanned terms, not words or valid chips, at the 64-term boundary", () => {
    const quoted = Array(64).fill('status:"Not Ready"').join(" ");
    expect(parseSearchFilters(quoted)).toHaveLength(64);
    expect(parseSearchFilters(quoted + " literal")).toEqual([]);
    expect(parseSearchFilters(Array(63).fill("literal").join(" ") + " name:api")).toHaveLength(1);
    expect(parseSearchFilters(Array(64).fill("literal").join(" ") + " name:api")).toEqual([]);
    expect(parseSearchFilters(Array(63).fill("name:api").join(" ") + ' unknown:"unclosed many words')).toHaveLength(63);
    expect(parseSearchFilters(Array(65).fill("name:api").join(" "))).toEqual([]);
  });
});

describe("search map identities", () => {
  it("preserves exact namespace and uses canonical GVR", () => {
    expect(searchResultMapIdentity({ cluster: "dev", kind: "pods", namespace: "prod", name: "api" })).toEqual({ group: "", version: "v1", resource: "pods", kind: "Pod", scope: "namespaced", namespace: "prod", name: "api" });
  });
  it("refuses virtual, unsupported and missing-scope identities", () => {
    for (const kind of ["helmreleases", "customresources", "unknown", "pods"]) {
      expect(searchResultMapIdentity({ cluster: "dev", kind, name: "api" })).toBeNull();
    }
  });
});
