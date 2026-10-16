import { fixedResourceIdentityRegistry } from "../shared/resourceMapIdentity";

/** Cache-search filters; mirror internal/dataplane/search_query.go's lexical contract. */
export type SearchFilter = { key: string; value: string; raw: string; start: number; end: number };
const filterKeys = new Set(["kind", "ns", "namespace", "name", "cluster", "context", "health", "status", "signal", "attention"]);

const kinds = new Set([
  ...Object.values(fixedResourceIdentityRegistry).flatMap((descriptor) => descriptor ? [descriptor.resource, descriptor.kind.toLowerCase()] : []),
  "clusterresource", "clusterresources", "customresource", "customresources", "helmrelease", "helmreleases",
  "pvc", "pvcs", "pv", "pvs", "hpa", "hpas", "crd", "crds",
]);

// Go unicode.IsSpace includes NEL, but not BOM (unlike JavaScript \s/trim).
const whitespace = /\p{White_Space}/u;
const trimWhitespace = (value: string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

export function parseSearchFilters(query: string): SearchFilter[] {
  if (/^\s*[:>]/.test(query)) return [];
  const trimmed = trimWhitespace(query);
  if (/^[:>]/.test(trimmed) || new TextEncoder().encode(trimmed).length > 4096) return [];
  const filters: SearchFilter[] = [];
  let terms = 0;
  let offset = 0;
  while (offset < query.length) {
    if (whitespace.test(query[offset])) {
      offset++;
      continue;
    }
    const start = offset;
    while (offset < query.length && !whitespace.test(query[offset])) offset++;
    const colon = query.slice(start, offset).indexOf(":");
    if (colon >= 0 && query[start + colon + 1] === '"') {
      const close = query.indexOf('"', start + colon + 2);
      // No escapes: the first quote closes the value; any suffix belongs to it.
      offset = close < 0 ? query.length : close + 1;
      while (offset < query.length && !whitespace.test(query[offset])) offset++;
    }
    if (++terms > 64) return [];
    const raw = query.slice(start, offset);
    if (colon < 1) continue;
    const key = raw.slice(0, colon).toLowerCase();
    let value = raw.slice(colon + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!filterKeys.has(key) || !trimWhitespace(value) || /["\\]/.test(value) || (key === "kind" && !kinds.has(value.toLowerCase())) || (key === "attention" && !/^(true|false)$/i.test(value))) continue;
    // Display spelling is retained; offsets are UTF-16 indices for exact slicing.
    filters.push({ key, value, raw, start, end: offset });
  }
  return filters;
}

/** Commit only delimited tokens while editing: `kind:pod` may still become
 * `kind:pods`. Blur explicitly commits the final token. Literal draft bytes,
 * quotes and whitespace remain untouched. */
export function tokenizeSearchDraft(draft: string, complete = false): { tokens: string[]; draft: string } {
  const filters = parseSearchFilters(draft).filter((filter) => complete || filter.end < draft.length);
  let rest = draft;
  for (const filter of [...filters].reverse()) rest = removeSearchFilter(rest, filter);
  return { tokens: filters.map((filter) => filter.raw), draft: rest };
}

/** Delete only the selected token; retain all other bytes, including whitespace. */
export function removeSearchFilter(query: string, filter: SearchFilter): string {
  if (query.slice(filter.start, filter.end) !== filter.raw) return query;
  return query.slice(0, filter.start) + query.slice(filter.end);
}
