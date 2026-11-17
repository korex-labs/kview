package dataplane

import (
	"net/url"
	"sort"
	"strings"
)

// NamespaceEnrichHints selects which namespaces receive background row enrichment.
// Only names that appear in the current list snapshot are eligible.
type NamespaceEnrichHints struct {
	Focus    string
	Recent   []string
	Favorite map[string]struct{}
}

const (
	// Scoring: higher runs first. Focus (current UI namespace) beats favorites beats recency.
	nsEnrichScoreFocus    = 1_000_000
	nsEnrichScoreFavorite = 10_000
	nsEnrichScoreRecent   = 500
	nsEnrichMaxTargets    = 32
)

// ParseNamespaceEnrichHints reads optional GET /api/namespaces query parameters:
//   - enrichFocus: current namespace
//   - enrichRecent: comma-separated MRU names (most significant first in the string)
//   - enrichFav: comma-separated favourites
//
// Repeated query keys for enrichRecent / enrichFav are merged in order.
func ParseNamespaceEnrichHints(q url.Values) NamespaceEnrichHints {
	h := NamespaceEnrichHints{Favorite: make(map[string]struct{})}

	h.Focus = strings.TrimSpace(q.Get("enrichFocus"))

	for _, key := range []string{"enrichRecent", "enrichFav"} {
		for _, raw := range q[key] {
			for _, p := range strings.Split(raw, ",") {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				if key == "enrichRecent" {
					h.Recent = append(h.Recent, p)
				} else {
					h.Favorite[p] = struct{}{}
				}
			}
		}
		if len(q[key]) == 0 {
			single := strings.TrimSpace(q.Get(key))
			if single == "" {
				continue
			}
			for _, p := range strings.Split(single, ",") {
				p = strings.TrimSpace(p)
				if p == "" {
					continue
				}
				if key == "enrichRecent" {
					h.Recent = append(h.Recent, p)
				} else {
					h.Favorite[p] = struct{}{}
				}
			}
		}
	}

	return h
}

func namespaceEnrichScore(name string, hints NamespaceEnrichHints, recentRank map[string]int) int {
	score := 0
	if name != "" && name == hints.Focus {
		score += nsEnrichScoreFocus
	}
	if _, ok := hints.Favorite[name]; ok {
		score += nsEnrichScoreFavorite
	}
	if r, ok := recentRank[name]; ok && len(hints.Recent) > 0 {
		// Earlier in Recent slice => larger bump (smaller index).
		score += (len(hints.Recent) - r) * nsEnrichScoreRecent
	}
	return score
}

// buildEnrichmentWorkOrder returns namespaces to enrich, highest score first, capped.
// itemOrder is the list snapshot order (used only for stable tie-break; no alphabetical scan).
func buildEnrichmentWorkOrder(itemOrder []string, hints NamespaceEnrichHints, maxTargets int) []string {
	present := make(map[string]bool, len(itemOrder))
	pos := make(map[string]int, len(itemOrder))
	for i, n := range itemOrder {
		if n == "" {
			continue
		}
		present[n] = true
		if _, ok := pos[n]; !ok {
			pos[n] = i
		}
	}

	recentRank := make(map[string]int)
	for i, n := range hints.Recent {
		if _, ok := recentRank[n]; !ok {
			recentRank[n] = i
		}
	}

	seen := make(map[string]struct{})
	var candidates []string
	tryAdd := func(n string) {
		if n == "" || !present[n] {
			return
		}
		if _, ok := seen[n]; ok {
			return
		}
		seen[n] = struct{}{}
		candidates = append(candidates, n)
	}

	tryAdd(hints.Focus)
	for _, n := range hints.Recent {
		tryAdd(n)
	}
	for n := range hints.Favorite {
		tryAdd(n)
	}

	if len(candidates) == 0 {
		return nil
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		sa := namespaceEnrichScore(a, hints, recentRank)
		sb := namespaceEnrichScore(b, hints, recentRank)
		if sa != sb {
			return sa > sb
		}
		return pos[a] < pos[b]
	})

	if maxTargets <= 0 {
		maxTargets = nsEnrichMaxTargets
	}
	if len(candidates) > maxTargets {
		candidates = candidates[:maxTargets]
	}
	return candidates
}

// effectiveNamespaceEnrichmentNames is pure upstream enrichment eligibility,
// including the entire sweep set rather than its transient queue or completion ledger.
// It is not a History population filter.
func effectiveNamespaceEnrichmentNames(order []string, hints NamespaceEnrichHints, policy NamespaceEnrichmentPolicy) []string {
	if !policy.Enabled {
		return nil
	}
	out := buildEnrichmentWorkOrder(order, applyNamespaceEnrichmentPolicyHints(hints, policy), policy.MaxTargets)
	seen := make(map[string]bool, len(out))
	for _, n := range out {
		seen[n] = true
	}
	for _, n := range order {
		if namespaceSweepEligible(n, policy) && !seen[n] {
			out = append(out, n)
			seen[n] = true
		}
	}
	return out
}
func namespaceSweepEligible(name string, policy NamespaceEnrichmentPolicy) bool {
	return policy.Enabled && policy.Sweep.Enabled && name != "" && (policy.Sweep.IncludeSystemNamespaces || !isSystemNamespace(name))
}

func applyNamespaceEnrichmentPolicyHints(hints NamespaceEnrichHints, policy NamespaceEnrichmentPolicy) NamespaceEnrichHints {
	out := NamespaceEnrichHints{Favorite: make(map[string]struct{})}
	if policy.IncludeFocus {
		out.Focus = hints.Focus
	}
	if policy.IncludeRecent && policy.RecentLimit > 0 {
		limit := policy.RecentLimit
		if len(hints.Recent) < limit {
			limit = len(hints.Recent)
		}
		out.Recent = append(out.Recent, hints.Recent[:limit]...)
	}
	if policy.IncludeFavourites && policy.FavouriteLimit > 0 {
		names := make([]string, 0, len(hints.Favorite))
		for n := range hints.Favorite {
			names = append(names, n)
		}
		sort.Strings(names)
		if len(names) > policy.FavouriteLimit {
			names = names[:policy.FavouriteLimit]
		}
		for _, n := range names {
			out.Favorite[n] = struct{}{}
		}
	}
	return out
}
