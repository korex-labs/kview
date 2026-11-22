package localhistory

import (
	"encoding/json"
	"slices"
	"sort"
	"time"
)

func (d TrendDomain) comparison(cutoff time.Time) *SparseComparison {
	if !d.ComparisonLostAt.IsZero() {
		return nil
	}
	if d.LastComplete != nil && !d.LastComplete.At.Before(cutoff) {
		if d.LastComplete.UsesCurrent {
			c := *d.LastComplete
			c.Signals, c.UsesCurrent = d.Signals, false
			return &c
		}
		return d.LastComplete
	}
	if !d.BaselineKnown || !d.Complete || (d.TransitionsUnknown && !d.RestoredComplete) || d.SourceAt.IsZero() || d.SourceAt.Before(cutoff) {
		return nil
	}
	return &SparseComparison{At: d.SourceAt, Policy: d.BaselinePolicy, Generation: d.Generation, Signals: d.Signals}
}

func (d TrendDomain) retainedSignals() int {
	n := len(d.Signals)
	if d.LastComplete != nil {
		n += len(d.LastComplete.Signals)
	}
	return n
}

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
			d.BaselinePolicy = d.effectivePolicy(old.Policy)
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
					status, at, fingerprint := next.AbsentDomainEvidence(p.Namespace, p.Rule)
					d.PolicyFingerprint = fingerprint
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
	if !next.FullProjection {
		for _, p := range prior {
			raw, _ := json.Marshal(p)
			reservedSignals += p.retainedSignals()
			reservedBytes += len(raw) + 1
		}
	}
	// Reserve the actual envelope plus room for reducer-owned counters and reasons.
	envelope := next
	envelope.Domains = nil
	metadata, _ := json.Marshal(envelope)
	budget := trendStateMaxBytes - len(metadata) - 4096
	pending := make(map[string]*SparseComparison)
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
			replay := !d.CachedPopulation && exists && p.BaselineKnown && p.BaselinePolicy == d.effectivePolicy(next.Policy) && !fresh
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
				d.BaselinePolicy = d.effectivePolicy(next.Policy)
				d.ObservedAt = next.At
			}
		}
		if next.FullProjection && updated {
			d.LastComplete = nil
			d.ComparisonLostAt = time.Time{}
			prior := p.comparison(next.comparisonCutoff)
			if d.Generation == "canonical-empty" {
				// Missing is not an observed empty population. Keep private comparison
				// evidence, but do not give this attempt a new source timestamp.
				d.Complete, d.BaselineKnown = false, false
				d.SourceAt = p.SourceAt
				d.Reason = d.SourceStatus
			}
			if prior != nil && prior.Policy == d.BaselinePolicy && (d.comparison(next.comparisonCutoff) == nil || d.SourceAt.Before(prior.At) || (d.RestoredComplete && !d.SourceAt.After(prior.At))) {
				c := *prior
				if slices.Equal(c.Signals, d.Signals) {
					c.Signals, c.UsesCurrent = nil, true
				}
				pending[k] = &c
				d.ComparisonLostAt = prior.At // cleared only when auxiliary state fits
			} else if !p.ComparisonLostAt.IsZero() && (d.comparison(next.comparisonCutoff) == nil || d.RestoredComplete || d.SourceAt.Before(p.ComparisonLostAt)) {
				d.ComparisonLostAt = p.ComparisonLostAt
			}
		}
		raw, _ := json.Marshal(d)
		if exists && !next.FullProjection {
			pr, _ := json.Marshal(p)
			reservedSignals -= p.retainedSignals()
			reservedBytes -= len(pr) + 1
		}
		if len(merged) >= TrendMaxDomains || signals+reservedSignals+d.retainedSignals() > TrendMaxSignals || size+reservedBytes+len(raw)+1 > budget {
			losses++
			if !exists || next.FullProjection {
				continue
			}
			// A too-large replacement cannot evict an admitted baseline or block peers.
			d = p
			d.Complete = false
			d.Gap = true
			d.CarriedForward = p.BaselineKnown
			d.Reason = "domain-cap"
			raw, _ = json.Marshal(d)
			if signals+d.retainedSignals() > TrendMaxSignals || size+len(raw)+1 > budget {
				continue
			}
		}
		signals += d.retainedSignals()
		size += len(raw) + 1
		merged = append(merged, d)
	}
	// Fit comparisons only after every canonical domain has had its admission.
	for i := range merged {
		d := &merged[i]
		c := pending[trendDomainKey(*d)]
		if c == nil || signals+len(c.Signals) > TrendMaxSignals {
			continue
		}
		raw, _ := json.Marshal(c)
		lostAt, _ := json.Marshal(d.ComparisonLostAt)
		extra := len(raw) + len(`,"lastComplete":`) - len(`,"comparisonLostAt":`) - len(lostAt)
		if size+extra <= budget {
			d.LastComplete, d.ComparisonLostAt = c, time.Time{}
			size += extra
			signals += len(c.Signals)
		}
	}
	next.Domains = merged
	if old.Context != next.Context || old.Epoch != next.Epoch {
		old.PodObservations = nil
	}
	next.capturePodObservations(old, incoming, keys)
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
