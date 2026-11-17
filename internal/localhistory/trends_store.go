package localhistory

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	bolt "go.etcd.io/bbolt"
	"sort"
	"time"
)

var trendBucket = []byte("signal-trends-v1")

const trendStateMaxBytes = 8 << 20
const trendHourMaxBytes = 2 << 20
const trendRetainedMaxBytes = 64 << 20

// Account conservatively for strings, structs and query indexes, not just JSON.
const trendQueryMemoryBudget = 32 << 20

// ErrTrendQueryLimit is a bounded-query rejection, not a storage failure.
var ErrTrendQueryLimit = errors.New("trend query memory cap: narrow the range")

func signalContextKey(name string) []byte { b, _ := json.Marshal([]string{name}); return b }

func decodeTrend(v []byte, out any, limit int) error {
	if len(v) > limit {
		return errors.New("trend payload cap")
	}
	if len(v) == 0 {
		return nil
	}
	return json.Unmarshal(v, out)
}

// Prune commits independently of admission, so a full store can recover. No old
// bucket is touched; logical accounting includes current compact evidence + hours.
func (s *Store) pruneTrends(at time.Time) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		if root == nil {
			return errors.New("trends unavailable")
		}
		retained := number(root.Get([]byte("bytes")))
		returnErr := root.ForEach(func(k, v []byte) error {
			if v != nil {
				return nil
			}
			b := root.Bucket(k)
			h := b.Bucket([]byte("hours"))
			if h == nil {
				return nil
			}
			cutoff := stamp(at.Add(-time.Duration(s.retention) * 24 * time.Hour).Truncate(time.Hour).Unix())
			c := h.Cursor()
			for key, value := c.First(); key != nil && bytes.Compare(key, cutoff) < 0; key, value = c.Next() {
				retained -= int64(len(value))
				if e := c.Delete(); e != nil {
					return e
				}
			}
			var old TrendBatch
			if e := decodeTrend(b.Get([]byte("current")), &old, trendStateMaxBytes); e != nil {
				return e
			}
			cut := at.Add(-time.Duration(s.retention) * 24 * time.Hour)
			kept := old.Domains[:0]
			for _, d := range old.Domains {
				if !d.SourceAt.IsZero() && !d.SourceAt.Before(cut) {
					kept = append(kept, d)
				}
			}
			if len(kept) != len(old.Domains) {
				old.Domains = kept
				data, err := json.Marshal(old)
				if err != nil {
					return err
				}
				retained += int64(len(data) - len(b.Get([]byte("current"))))
				if err = b.Put([]byte("current"), data); err != nil {
					return err
				}
			}
			return nil
		})
		if returnErr != nil {
			return returnErr
		}
		if retained < 0 {
			return errors.New("invalid trend accounting")
		}
		return root.Put([]byte("bytes"), stamp(retained))
	})
}
func (s *Store) AppendTrends(batch TrendBatch) error {
	s.transitionMu.Lock()
	defer s.transitionMu.Unlock()
	if e := batch.Validate(); e != nil {
		return e
	}
	if e := s.pruneTrends(batch.At); e != nil {
		return e
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		root := tx.Bucket(trendBucket)
		if root == nil || string(root.Get([]byte("schema"))) != "1" {
			return errors.New("trends unavailable")
		}
		if e := historyDiskGuard(tx.Size()); e != nil {
			return e
		}
		key := signalContextKey(batch.Context)
		if root.Bucket(key) == nil {
			n := 0
			_ = root.ForEach(func(_, v []byte) error {
				if v == nil {
					n++
				}
				return nil
			})
			if n >= MaxScopes {
				return errors.New("trend context cap")
			}
		}
		b, e := root.CreateBucketIfNotExists(key)
		if e != nil {
			return e
		}
		var old TrendBatch
		if e = decodeTrend(b.Get([]byte("current")), &old, trendStateMaxBytes); e != nil {
			return e
		}
		if batch.At.Before(old.At) {
			return nil
		}
		trace := cloneTransitionDiagnostics(s.transitions[batch.Context], batch.Context, batch.Epoch)
		trace.AcceptedAt = batch.At
		trace.Coalesced = batch.Diagnostics.Coalesced
		trace.Overflow = batch.Diagnostics.Overflow
		batch.transitionTrace = trace
		next, hour := reduceTrends(old, batch)
		tx.OnCommit(func() {
			if s.transitions == nil {
				s.transitions = make(map[string]*TransitionDiagnostics)
			}
			s.transitions[batch.Context] = trace
		})
		if batch.FullProjection && next.Diagnostics.CapLosses > batch.Diagnostics.CapLosses {
			return errors.New("canonical projection storage cap: no partial total accepted")
		}

		next.Diagnostics.LastSample = time.Time{}
		next.Diagnostics.SourceAt = time.Time{}
		for _, d := range next.Domains {
			if d.BaselineKnown && d.ObservedAt.After(next.Diagnostics.LastSample) {
				next.Diagnostics.LastSample = d.ObservedAt
			}
			if d.BaselineKnown && (next.Diagnostics.SourceAt.IsZero() || d.SourceAt.Before(next.Diagnostics.SourceAt)) {
				next.Diagnostics.SourceAt = d.SourceAt
			}
		}
		h, e := b.CreateBucketIfNotExists([]byte("hours"))
		if e != nil {
			return e
		}
		hk := stamp(hour.At.Unix())
		var prior TrendHour
		if e = decodeTrend(h.Get(hk), &prior, trendHourMaxBytes); e != nil {
			return e
		}
		// Hourly compaction must obey the same identity boundary as the reducer.
		// Otherwise a reset with no baseline inherits old-epoch transitions with
		// a zero sample timestamp (and may even retain old node identities).
		if old.Epoch != next.Epoch {
			prior = TrendHour{}
		}
		// Last observed active subtotal, summed confirmed transitions; retain coverage
		// warnings across the hour without erasing usable contributions.
		groups := map[string]*TrendGroup{}
		for i := range hour.Groups {
			g := &hour.Groups[i]
			groups[trendKey(g.Kind, g.Key)] = g
		}
		extra := []TrendGroup{}
		for _, p := range prior.Groups {
			g := groups[trendKey(p.Kind, p.Key)]
			if g == nil {
				if p.Counts != nil {
					p.ConfirmedChanges = p.Counts.Changes
				}
				p.Counts = nil
				p.Reason = "coverage-changed-within-hour"
				p.Coverage = "unknown"
				p.ChangesCoverage = "unknown"
				extra = append(extra, p)
				continue
			}
			if p.Counts != nil {
				p.ConfirmedChanges = p.Counts.Changes
			}
			g.ConfirmedChanges += p.ConfirmedChanges
			if g.ConfirmedChanges > 0 && g.ChangesCoverage == "unknown" {
				g.ChangesCoverage = "partial"
			}
			if p.ChangesCoverage != "complete" || old.Policy != next.Policy || old.Epoch != next.Epoch {
				if g.ChangesCoverage == "complete" {
					g.ChangesCoverage = "partial"
				}
			}
			if p.Counts == nil || g.Counts == nil {
				if g.Reason == "" {
					g.Reason = "gap-within-hour"
				}
			}
			if g.Counts != nil {
				g.Counts.Changes = g.ConfirmedChanges
			}
			if old.Policy != next.Policy || old.Epoch != next.Epoch {
				g.Reason = "policy-changed-within-hour"
			}
			if p.Coverage != "complete" && g.Reason == "" {
				g.Reason = "partial-within-hour"
			}
			if g.Counts == nil {
				g.Coverage = "unknown"
			} else if g.Reason != "" {
				g.Coverage = "partial"
			}
		}
		hour.Groups = append(hour.Groups, extra...)
		admitTrendGroups(&next, &hour, prior)
		if batch.FullProjection && next.Diagnostics.CapLosses > batch.Diagnostics.CapLosses {
			return errors.New("canonical projection storage cap: no partial total accepted")
		}

		current, e := json.Marshal(next)
		if e != nil {
			return e
		}
		payload, e := json.Marshal(hour)
		if e != nil {
			return e
		}
		if len(current) > trendStateMaxBytes || len(payload) > trendHourMaxBytes {
			return errors.New("trend payload cap")
		}
		retained := number(root.Get([]byte("bytes"))) + int64(len(current)-len(b.Get([]byte("current")))+len(payload)-len(h.Get(hk)))
		if retained < 0 || retained > trendRetainedMaxBytes {
			return errors.New("trend retained byte cap")
		}
		if e = b.Put([]byte("current"), current); e != nil {
			return e
		}
		if e = h.Put(hk, payload); e != nil {
			return e
		}
		return root.Put([]byte("bytes"), stamp(retained))
	})
}
func (s *Store) QueryTrends(q TrendQuery) (TrendResponse, error) {
	return s.QueryTrendsContext(context.Background(), q)
}

// QueryTrendsContext cooperatively stops scans and projections when the caller leaves.
func (s *Store) QueryTrendsContext(ctx context.Context, q TrendQuery) (TrendResponse, error) {
	q.Normalize()
	asOf := q.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	if asOf.After(q.To) {
		asOf = q.To
	}
	out := TrendResponse{AsOf: asOf, SchemaVersion: 1, Context: q.Context, From: q.From, To: q.To, Severity: []TrendSeries{}, Rules: []TrendSeries{}, Nodes: []TrendSeries{}, Namespaces: []TrendSeries{}, Diagnostics: TrendDiagnostics{SupportedRules: []string{}, UnsupportedRules: []string{}, Reasons: map[string]int{}}}
	if e := q.Validate(); e != nil {
		return out, e
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	hours := []TrendHour{}
	e := s.db.View(func(tx *bolt.Tx) error {
		out.Diagnostics.DatabaseBytes = tx.Size()
		root := tx.Bucket(trendBucket)
		if root == nil {
			return nil
		}
		if string(root.Get([]byte("schema"))) != "1" {
			return errors.New("unsupported trend schema")
		}
		retained := number(root.Get([]byte("bytes")))
		b := root.Bucket(signalContextKey(q.Context))
		if b == nil {
			return nil
		}
		// Queries need diagnostics, not the potentially large transition evidence.
		var current struct {
			Epoch       string           `json:"epoch"`
			Diagnostics TrendDiagnostics `json:"diagnostics"`
		}
		if e := decodeTrend(b.Get([]byte("current")), &current, trendStateMaxBytes); e != nil {
			return e
		}
		out.Diagnostics = current.Diagnostics
		out.Diagnostics.RetainedBytes = retained
		out.Diagnostics.DatabaseBytes = tx.Size()
		if !out.Diagnostics.SourceAt.IsZero() {
			age := int64(asOf.Sub(out.Diagnostics.SourceAt) / time.Second)
			if age < 0 {
				age = 0
			}
			out.Diagnostics.SourceAgeSeconds = &age
		}
		h := b.Bucket([]byte("hours"))
		if h == nil {
			return nil
		}
		out.Diagnostics.RetainedHours = h.Stats().KeyN
		c := h.Cursor()
		memory := 0
		// Exactly one bounded predecessor hour: each persisted hour is a merged projection.
		k, v := c.Seek(stamp(q.From.Unix()))
		if k == nil {
			k, v = c.Last()
		} else if bytes.Compare(k, stamp(q.From.Unix())) >= 0 {
			pk, pv := c.Prev()
			if pk != nil {
				k, v = pk, pv
			} else {
				k, v = c.First()
			}
		}
		for ; k != nil && bytes.Compare(k, stamp(q.To.Unix())) < 0; k, v = c.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			// JSON decoding has bounded transient overhead, plus retained decoded indexes.
			if memory+8*len(v) > trendQueryMemoryBudget {
				return ErrTrendQueryLimit
			}
			var hour TrendHour
			if e := decodeTrend(v, &hour, trendHourMaxBytes); e != nil {
				return e
			}
			// Retained identities from another epoch must not enter rankings/catalogs.
			if hour.Epoch != current.Epoch {
				continue
			}
			// Pre-fix same-hour epoch compaction could combine old transitions and
			// identities with a new baseline's zero observation time. The original
			// epoch of individual groups is not retained, so this whole hour is
			// ambiguous. Isolate it in the response only; never rewrite evidence.
			for _, g := range hour.Groups {
				changes := g.ConfirmedChanges
				if g.Counts != nil {
					changes = g.Counts.Changes
				}
				if changes > 0 && (g.SampleAt.IsZero() || g.SampleAt.Before(hour.At)) {
					hour.Groups = []TrendGroup{{Kind: "severity", Key: "all", Label: "all", TrendPoint: TrendPoint{At: hour.At, Reason: "invalid-retained-hour", Coverage: "unknown", ChangesCoverage: "unknown", Freshness: "unknown"}}}
					if out.Diagnostics.Reasons == nil {
						out.Diagnostics.Reasons = map[string]int{}
					}
					out.Diagnostics.Reasons["invalid-retained-hour"]++
					break
				}
			}
			for _, g := range hour.Groups {
				if err := ctx.Err(); err != nil {
					return err
				}
				memory += 768 + len(g.Key)*3 + len(g.Kind)*3 + len(g.Label)*2 + len(g.Reason)
			}
			if memory > trendQueryMemoryBudget {
				return ErrTrendQueryLimit
			}
			hours = append(hours, hour)
		}
		return nil
	})
	if e != nil {
		return out, e
	}
	all := map[string]map[string]*TrendSeries{}
	byHour := map[int64]map[string]TrendPoint{}
	epochBoundaries := map[int64]bool{}
	lastEpoch := ""
	for _, h := range hours {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if lastEpoch != "" && h.Epoch != "" && lastEpoch != h.Epoch {
			epochBoundaries[h.At.Unix()] = true
		}
		if h.Epoch != "" {
			lastEpoch = h.Epoch
		}
		if len(h.Groups) == 1 && h.Groups[0].Reason == "invalid-retained-hour" {
			epochBoundaries[h.At.Unix()] = true
		}
		index := make(map[string]TrendPoint, len(h.Groups))
		byHour[h.At.Unix()] = index
		for _, g := range h.Groups {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			if g.SampleAt.After(asOf) || h.At.After(asOf) {
				continue
			}
			if g.Counts != nil {
				g.ConfirmedChanges = g.Counts.Changes
			}
			index[trendKey(g.Kind, g.Key)] = g.TrendPoint
			if all[g.Kind] == nil {
				all[g.Kind] = map[string]*TrendSeries{}
			}
			v := all[g.Kind][g.Key]
			if v == nil {
				v = &TrendSeries{Key: g.Key, Label: g.Label}
				all[g.Kind][g.Key] = v
			}
			// Scores are computed from the same forward-only projection as points below.
		}
	}
	predecessor := map[string]TrendPoint{}
	for _, h := range hours {
		if h.At.Before(q.From) {
			predecessor = byHour[h.At.Unix()]
		}
	}
	type zeroEvidence struct{ highObserved, highNonzeroOrUnknown bool }
	zeroOnly := map[string]zeroEvidence{}
	for kind, entries := range all {
		for key, series := range entries {
			evidence := zeroEvidence{}
			last := predecessor[trendKey(kind, key)]
			for at := q.From; at.Before(q.To); at = at.Add(time.Hour) {
				if err := ctx.Err(); err != nil {
					return out, err
				}
				if epochBoundaries[at.Unix()] {
					last = TrendPoint{}
				}
				point, ok := byHour[at.Unix()][trendKey(kind, key)]
				p := projectTrendPoint(at, asOf, last, point, ok, time.Duration(s.retention)*24*time.Hour)
				if ok && !point.SampleAt.After(asOf) {
					last = point
				}
				if p.Counts != nil {
					series.HighScore += p.Counts.High
				}
				series.ChangesScore += p.ConfirmedChanges
				if p.Counts != nil {
					evidence.highObserved = true
					// Rank the plotted High measure, not transition activity or
					// other severities. Incomplete zero subtotals cannot prove zero.
					evidence.highNonzeroOrUnknown = evidence.highNonzeroOrUnknown || p.Counts.High != 0 || p.Coverage != "complete"
				}

			}
			zeroOnly[trendKey(kind, key)] = evidence
		}
	}
	out.Catalog, e = catalogFromSeriesContext(ctx, all)
	if e != nil {
		return out, e
	}
	selectSeries := func(kind, mode string, chosen []string) ([]TrendSeries, error) {
		available := all[kind]
		keys := []string{}
		if mode == "topHigh10" || mode == "topChanges10" {
			for k := range available {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				evidence := zeroOnly[trendKey(kind, k)]
				// Top Changes ranks recorded transitions, not uncertainty. Never
				// fill spare slots with zero-score partial or unknown series.
				if mode == "topChanges10" && available[k].ChangesScore <= 0 {
					continue
				}
				if mode == "topHigh10" && evidence.highObserved && !evidence.highNonzeroOrUnknown {
					continue
				}
				keys = append(keys, k)
			}
			sort.Slice(keys, func(i, j int) bool {
				a, b := available[keys[i]], available[keys[j]]
				av, bv := a.HighScore, b.HighScore
				if mode == "topChanges10" {
					av, bv = a.ChangesScore, b.ChangesScore
				}
				if av != bv {
					return av > bv
				}
				return keys[i] < keys[j]
			})
			if len(keys) > 10 {
				keys = keys[:10]
			}
		} else {
			keys = append(keys, chosen...)
		}
		result := []TrendSeries{}
		for _, k := range keys {
			series := TrendSeries{Key: k, Label: k, Points: []TrendPoint{}}
			if v := available[k]; v != nil {
				series = *v
				series.Points = []TrendPoint{}
			}
			last := predecessor[trendKey(kind, k)]
			for at := q.From; at.Before(q.To); at = at.Add(time.Hour) {
				if err := ctx.Err(); err != nil {
					return nil, err
				}
				if epochBoundaries[at.Unix()] {
					last = TrendPoint{}
				}
				point, ok := byHour[at.Unix()][trendKey(kind, k)]
				p := projectTrendPoint(at, asOf, last, point, ok, time.Duration(s.retention)*24*time.Hour)
				if ok && !point.SampleAt.After(asOf) {
					last = point
				}
				series.Points = append(series.Points, p)
			}
			result = append(result, series)
		}
		return result, ctx.Err()
	}
	if out.Severity, e = selectSeries("severity", "custom", []string{"all"}); e != nil {
		return out, e
	}
	if out.Rules, e = selectSeries("rules", q.RulesMode, q.Rules); e != nil {
		return out, e
	}
	if out.Nodes, e = selectSeries("nodes", q.NodesMode, q.Nodes); e != nil {
		return out, e
	}
	if out.Namespaces, e = selectSeries("namespaces", q.NamespacesMode, q.Namespaces); e != nil {
		return out, e
	}
	out.Diagnostics.CoverageGaps = 0
	for _, p := range out.Severity[0].Points {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if p.Counts == nil || p.Coverage != "complete" {
			out.Diagnostics.CoverageGaps++
		}
	}
	return out, nil
}
