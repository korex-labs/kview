package localhistory

import (
	"encoding/json"
	"sort"
)

// Preserve severity and already admitted hourly groups before admitting new keys.
// Source evidence has independent hard domain/signal/byte bounds; group overflow
// must not roll back the useful aggregate or freeze the transition baseline.
func admitTrendGroups(next *TrendBatch, hour *TrendHour, prior TrendHour) {
	raw, _ := json.Marshal(hour)
	if len(hour.Groups) <= TrendMaxGroups && len(raw) <= trendHourMaxBytes {
		return
	}
	retained := make(map[string]bool, len(prior.Groups))
	for _, g := range prior.Groups {
		retained[trendKey(g.Kind, g.Key)] = true
	}
	sort.Slice(hour.Groups, func(i, j int) bool {
		a, b := hour.Groups[i], hour.Groups[j]
		if (a.Kind == "severity") != (b.Kind == "severity") {
			return a.Kind == "severity"
		}
		ak, bk := trendKey(a.Kind, a.Key), trendKey(b.Kind, b.Key)
		if retained[ak] != retained[bk] {
			return retained[ak]
		}
		return ak < bk
	})
	before := len(hour.Groups)
	kept := hour.Groups[:0]
	bytes := 2048 // hour envelope and bounded policy/epoch identifiers
	for _, g := range hour.Groups {
		encoded, _ := json.Marshal(g)
		if len(kept) >= TrendMaxGroups || bytes+len(encoded)+1 > trendHourMaxBytes {
			continue
		}
		bytes += len(encoded) + 1
		kept = append(kept, g)
	}
	hour.Groups = kept
	lost := before - len(kept)
	// Copy caller-owned diagnostics before adding ingestion-owned admission evidence.
	reasons := make(map[string]int, len(next.Diagnostics.Reasons)+1)
	for k, v := range next.Diagnostics.Reasons {
		reasons[k] = v
	}
	reasons["group-cap"] = lost
	next.Diagnostics.Reasons = reasons
	next.Diagnostics.CapLosses += lost
}
