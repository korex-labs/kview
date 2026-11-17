package localhistory

import (
	"encoding/json"
	"sort"
	"time"
)

// reduceTrends merges dirty domains. Absence is not a deletion. Persisted verified
// evidence is independent of the most recent attempt's coverage and batch clock.
func reduceTrends(old, next TrendBatch) (TrendBatch, TrendHour) {
	old.Domains = append([]TrendDomain(nil), old.Domains...)
	if old.Context != next.Context || old.Epoch != next.Epoch {
		old.Domains = nil
	}
	prior := make(map[string]TrendDomain, len(old.Domains))
	for i := range old.Domains {
		d := &old.Domains[i]
		if d.Complete && !d.BaselineKnown {
			d.BaselineKnown = true
			d.BaselinePolicy = old.Policy
			d.ObservedAt = old.At
		}
		prior[trendDomainKey(*d)] = *d
	}
	incoming := make(map[string]TrendDomain, len(next.Domains))
	for _, d := range next.Domains {
		incoming[trendDomainKey(d)] = d
	}
	if next.FullProjection {
		// Canonical projections replace the active population. Missing old domains
		// have unknown transition evidence, never a confirmed disappearance;
		// old policy/independent baselines never compare.
		for k, p := range prior {
			if _, exists := incoming[k]; !exists {
				incoming[k] = TrendDomain{Namespace: p.Namespace, Rule: p.Rule, Complete: true, CachedPopulation: true, SourceAt: next.At, Generation: "canonical-empty", TransitionsUnknown: true, SourceStatus: "domain-not-observed"}
				if next.AbsentDomainEvidence != nil {
					d := incoming[k]
					status, at := next.AbsentDomainEvidence(p.Namespace, p.Rule)
					if validTransitionSourceStatus(status) && status != "" && status != "available" {
						d.SourceStatus, d.EvidenceAt = status, at
					}
					incoming[k] = d
				}
			}
		}
	}
	keys := make([]string, 0, len(prior)+len(incoming))
	for k := range prior {
		keys = append(keys, k)
	}
	// Existing admissions always precede new domains, independently of input order.
	sort.Strings(keys)
	newKeys := []string{}
	for k := range incoming {
		if _, ok := prior[k]; !ok {
			newKeys = append(newKeys, k)
		}
	}
	sort.Strings(newKeys)
	keys = append(keys, newKeys...)
	merged := make([]TrendDomain, 0, len(keys))
	signals, size := 0, 0
	// Reserve every persisted admission before considering replacement growth.
	reservedSignals, reservedBytes := 0, 0
	for _, p := range prior {
		raw, _ := json.Marshal(p)
		reservedSignals += len(p.Signals)
		reservedBytes += len(raw) + 1
	}
	// Reserve the actual envelope plus room for reducer-owned counters and reasons.
	envelope := next
	envelope.Domains = nil
	metadata, _ := json.Marshal(envelope)
	budget := trendStateMaxBytes - len(metadata) - 4096
	losses := 0
	for _, k := range keys {
		p, exists := prior[k]
		d, updated := incoming[k]
		if !updated {
			d = p
			d.Complete = false
			d.Reason = "domain-not-observed"
			d.Gap = true
			d.CarriedForward = p.BaselineKnown
		} else {
			// These fields are reducer-owned, never accepted from an evaluator.
			d.BaselineKnown = false
			d.BaselinePolicy = ""
			d.ObservedAt = time.Time{}
			d.Gap = false
			d.CarriedForward = false
			valid := d.Complete && (d.CachedPopulation || (!d.SourceAt.IsZero() && !d.SourceAt.After(next.At) && next.At.Sub(d.SourceAt) <= 15*time.Minute))
			fresh := d.SourceAt.After(p.SourceAt)
			if d.Generation != "" && p.Generation != "" {
				fresh = d.Generation != p.Generation
			}
			replay := !d.CachedPopulation && exists && p.BaselineKnown && p.BaselinePolicy == next.Policy && !fresh
			if !valid || replay {
				if next.transitionTrace != nil {
					attempt := d
					attempt.Complete = false
					attempt.ObservedAt = next.At
					if attempt.SourceStatus == "" {
						attempt.EvidenceAt = d.SourceAt
					}
					if replay {
						attempt.SourceStatus = "source-replay"
					}
					if !valid && attempt.SourceStatus == "" {
						attempt.SourceStatus = "source-partial"
						if d.SourceAt.IsZero() {
							attempt.SourceStatus = "source-missing"
						} else if next.At.Sub(d.SourceAt) > 15*time.Minute {
							attempt.SourceStatus = "source-stale"
						}
					}
					next.transitionTrace.rejectAttempt(old, next, p, attempt, exists, fresh)
				}
				reason := d.Reason
				if reason == "" {
					reason = "source-unavailable"
					if replay {
						reason = "source-replay"
					}
				}
				if exists && p.BaselineKnown {
					d = p
				} else {
					d.Signals = nil
					d.SourceAt = time.Time{}
					d.Generation = ""
				}
				d.Complete = false
				d.Reason = reason
				d.Gap = true
				d.CarriedForward = d.BaselineKnown
			} else {
				d.BaselineKnown = true
				d.BaselinePolicy = next.Policy
				d.ObservedAt = next.At
			}
		}
		raw, _ := json.Marshal(d)
		if exists {
			pr, _ := json.Marshal(p)
			reservedSignals -= len(p.Signals)
			reservedBytes -= len(pr) + 1
		}
		if len(merged) >= TrendMaxDomains || signals+reservedSignals+len(d.Signals) > TrendMaxSignals || size+reservedBytes+len(raw)+1 > budget {
			losses++
			if !exists {
				continue
			}
			// A too-large replacement cannot evict an admitted baseline or block peers.
			d = p
			d.Complete = false
			d.Gap = true
			d.CarriedForward = p.BaselineKnown
			d.Reason = "domain-cap"
			raw, _ = json.Marshal(d)
			if signals+len(d.Signals) > TrendMaxSignals || size+len(raw)+1 > budget {
				continue
			}
		}
		signals += len(d.Signals)
		size += len(raw) + 1
		merged = append(merged, d)
	}
	next.Domains = merged
	next.AcceptedSequence = old.AcceptedSequence + 1
	next.Diagnostics.Coalesced = max(next.Diagnostics.Coalesced, old.Diagnostics.Coalesced)
	next.Diagnostics.Overflow = max(next.Diagnostics.Overflow, old.Diagnostics.Overflow)
	next.Diagnostics.CapLosses += losses
	next, hour := reduceTrendGroups(old, next)
	for i := range hour.Groups {
		decorateTrendPoint(&hour.Groups[i].TrendPoint, next.At)
	}
	return next, hour
}

func decorateTrendPoint(p *TrendPoint, at time.Time) {
	p.Freshness = "unknown"
	p.SourceAgeSeconds = nil
	if p.SourceAt.IsZero() || p.SourceAt.After(at) {
		return
	}
	age := int64(at.Sub(p.SourceAt) / time.Second)
	p.SourceAgeSeconds = &age
	p.Freshness = "fresh"
	if age > 15*60 || p.CarriedForward {
		p.Freshness = "stale"
	}
}
