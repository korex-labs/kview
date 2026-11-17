package localhistory

import (
	"encoding/json"
	"errors"
	"sort"
	"time"
)

const TrendMaxScopes = 1024
const TrendMaxDomains = 32768
const TrendMaxSignals = 20000
const TrendMaxGroups = 4096
const TrendMaxSelections = 20

// TrendSignal is compact transition evidence, not an instance history page.
// ID is an opaque canonical detector identity; no raw resource object is stored.
type TrendSignal struct {
	// Multiplicity retains exact active totals when bounded identity evidence is compacted.
	ResourceUID  string `json:"resourceUID,omitempty"`
	Multiplicity int    `json:"multiplicity,omitempty"`
	ID           string `json:"id"`
	// IdentityKey ties UID-known and UID-unknown evidence to the same resource.
	IdentityKey   string `json:"identityKey,omitempty"`
	IdentityKnown bool   `json:"identityKnown,omitempty"`
	Severity      string `json:"severity"`
	Node          string `json:"node,omitempty"`
}
type TrendDomain struct {
	// SourceStatus explains this domain's own consulted inputs, not cluster age.
	SourceStatus     string    `json:"sourceStatus,omitempty"`
	EvidenceAt       time.Time `json:"evidenceAt,omitempty"`
	CachedPopulation bool      `json:"cachedPopulation,omitempty"`
	// Verified evidence survives incomplete updates; Complete describes latest coverage.
	BaselineKnown      bool          `json:"baselineKnown,omitempty"`
	BaselinePolicy     string        `json:"baselinePolicy,omitempty"`
	ObservedAt         time.Time     `json:"observedAt,omitempty"`
	Gap                bool          `json:"gap,omitempty"`
	CarriedForward     bool          `json:"carriedForward,omitempty"`
	Namespace          string        `json:"namespace"`
	Rule               string        `json:"rule"`
	SourceAt           time.Time     `json:"sourceAt"`
	Generation         string        `json:"generation,omitempty"`
	Complete           bool          `json:"complete"`
	TransitionsUnknown bool          `json:"transitionsUnknown,omitempty"`
	Reason             string        `json:"reason,omitempty"`
	Signals            []TrendSignal `json:"signals"`
}
type TrendDiagnostics struct {
	Coalesced        uint64         `json:"coalesced,omitempty"`
	Overflow         uint64         `json:"overflow,omitempty"`
	EligibleScopes   int            `json:"eligibleScopes"`
	EvaluatedScopes  int            `json:"evaluatedScopes"`
	SnapshotCount    int            `json:"snapshotCount"`
	SupportedRules   []string       `json:"supportedRules"`
	UnsupportedRules []string       `json:"unsupportedRules"`
	LastSample       time.Time      `json:"lastSample"`
	SourceAt         time.Time      `json:"sourceAt"`
	SourceAgeSeconds *int64         `json:"sourceAgeSeconds"`
	CoverageGaps     int            `json:"coverageGaps"`
	CapLosses        int            `json:"capLosses"`
	RetainedBytes    int64          `json:"retainedBytes"`
	DatabaseBytes    int64          `json:"databaseBytes"`
	RetainedHours    int            `json:"retainedHours"`
	Reasons          map[string]int `json:"reasons"`
}
type TrendBatch struct {
	// Cache-captured evidence for a previously present domain absent from this
	// population. Used only during reduction; never persisted or called by GET.
	AbsentDomainEvidence func(namespace, rule string) (string, time.Time) `json:"-"`
	transitionTrace      *TransitionDiagnostics
	FullProjection       bool             `json:"fullProjection,omitempty"`
	AcceptedSequence     uint64           `json:"acceptedSequence,omitempty"`
	Context              string           `json:"context"`
	Epoch                string           `json:"epoch"`
	Policy               string           `json:"policy"`
	At                   time.Time        `json:"at"`
	Domains              []TrendDomain    `json:"domains"`
	Diagnostics          TrendDiagnostics `json:"diagnostics"`
}
type TrendCounts struct {
	High    int `json:"high"`
	Medium  int `json:"medium"`
	Low     int `json:"low"`
	Changes int `json:"changes"`
}
type TrendPoint struct {
	CarriedForward   bool         `json:"carriedForward,omitempty"`
	Freshness        string       `json:"freshness,omitempty"`
	SourceAgeSeconds *int64       `json:"sourceAgeSeconds"`
	ConfirmedChanges int          `json:"confirmedChanges"`
	At               time.Time    `json:"at"`
	Counts           *TrendCounts `json:"counts"`
	SampleAt         time.Time    `json:"sampleAt"`
	SourceAt         time.Time    `json:"sourceAt"`
	Reason           string       `json:"reason,omitempty"`
	Coverage         string       `json:"coverage"`
	ChangesCoverage  string       `json:"changesCoverage"`
}
type TrendGroup struct {
	Kind  string `json:"kind"`
	Key   string `json:"key"`
	Label string `json:"label"`
	TrendPoint
}
type TrendHour struct {
	Epoch  string       `json:"epoch,omitempty"`
	Policy string       `json:"policy,omitempty"`
	At     time.Time    `json:"at"`
	Groups []TrendGroup `json:"groups"`
}
type TrendSeries struct {
	Key          string       `json:"key"`
	Label        string       `json:"label"`
	HighScore    int          `json:"highScore"`
	ChangesScore int          `json:"changesScore"`
	Points       []TrendPoint `json:"points"`
}
type TrendResponse struct {
	TransitionDiagnostics *TransitionDiagnostics `json:"transitionDiagnostics,omitempty"`
	AsOf                  time.Time              `json:"asOf"`
	Catalog               TrendCatalog           `json:"catalog"`
	SchemaVersion         int                    `json:"schemaVersion"`
	Context               string                 `json:"context"`
	From                  time.Time              `json:"from"`
	To                    time.Time              `json:"to"`
	Severity              []TrendSeries          `json:"severity"`
	Rules                 []TrendSeries          `json:"rules"`
	Nodes                 []TrendSeries          `json:"nodes"`
	Namespaces            []TrendSeries          `json:"namespaces"`
	Diagnostics           TrendDiagnostics       `json:"diagnostics"`
}
type TrendQuery struct {
	TransitionDetails                    bool
	AsOf                                 time.Time
	Context                              string
	From, To                             time.Time
	RulesMode, NodesMode, NamespacesMode string
	Rules, Nodes, Namespaces             []string
}

func TrendNodeKey(name, uid string) string {
	b, _ := json.Marshal([]string{name, uid})
	return string(b)
}
func trendKey(parts ...string) string     { b, _ := json.Marshal(parts); return string(b) }
func trendDomainKey(d TrendDomain) string { return trendKey(d.Namespace, d.Rule) }
func (q *TrendQuery) Normalize() {
	if q.RulesMode == "" {
		q.RulesMode = "topHigh10"
	}
	if q.NodesMode == "" {
		q.NodesMode = "topChanges10"
	}
	if q.NamespacesMode == "" {
		q.NamespacesMode = "topHigh10"
	}
}
func (q TrendQuery) Validate() error {
	q.Normalize()
	if ValidateScope(Scope{Context: q.Context}) != nil || q.From.Unix() < 0 || !q.To.After(q.From) || q.To.Sub(q.From) > 90*24*time.Hour || !q.From.Equal(q.From.Truncate(time.Hour)) || !q.To.Equal(q.To.Truncate(time.Hour)) {
		return ErrInvalidQuery
	}
	for i, mode := range []string{q.RulesMode, q.NodesMode, q.NamespacesMode} {
		valid := mode == "custom" || mode == "topChanges10" || mode == "topHigh10" || (i == 2 && (mode == "favourites" || mode == "recent" || mode == "tag"))
		selections := [][]string{q.Rules, q.Nodes, q.Namespaces}[i]
		if !valid || len(selections) > TrendMaxSelections || ((mode == "topHigh10" || mode == "topChanges10") && len(selections) > 0) {
			return ErrInvalidQuery
		}
		seen := map[string]bool{}
		for _, v := range selections {
			if v == "" || len(v) > 1024 || seen[v] {
				return ErrInvalidQuery
			}
			seen[v] = true
			if i == 2 && ValidateScope(Scope{Context: q.Context, Namespace: v}) != nil {
				return ErrInvalidQuery
			}
			if i == 1 {
				var n []string
				if json.Unmarshal([]byte(v), &n) != nil || len(n) != 2 || n[0] == "" || n[1] == "" || len(n[0]) > 512 || len(n[1]) > 512 || TrendNodeKey(n[0], n[1]) != v {
					return ErrInvalidQuery
				}
			}
		}
	}
	return nil
}
func (b TrendBatch) Validate() error {
	if ValidateScope(Scope{Context: b.Context}) != nil || b.Epoch == "" || len(b.Epoch) > 128 || b.Policy == "" || len(b.Policy) > 128 || b.At.IsZero() || len(b.Domains) > TrendMaxDomains || len(b.Diagnostics.SupportedRules) > 128 || len(b.Diagnostics.UnsupportedRules) > 128 || len(b.Diagnostics.Reasons) > 64 {
		return errors.New("invalid trend batch")
	}
	n := 0
	seen := map[string]bool{}
	for _, d := range b.Domains {
		k := trendDomainKey(d)
		if ValidateScope(Scope{Context: b.Context, Namespace: d.Namespace}) != nil || d.Rule == "" || len(d.Rule) > 128 || len(d.Reason) > 128 || len(d.Generation) > 128 || !validTransitionSourceStatus(d.SourceStatus) || seen[k] {
			return errors.New("invalid trend domain")
		}
		seen[k] = true
		n += len(d.Signals)
		if n > TrendMaxSignals {
			return errors.New("trend signal cap")
		}
		ids := map[string]bool{}
		for _, s := range d.Signals {
			if len(s.ResourceUID) > 512 || s.Multiplicity < 0 || (s.Multiplicity > 0 && s.IdentityKnown) || s.ID == "" || len(s.ID) > 128 || len(s.IdentityKey) > 128 || ids[s.ID] || (s.Severity != "high" && s.Severity != "medium" && s.Severity != "low") || len(s.Node) > 1024 {
				return errors.New("invalid trend signal")
			}
			ids[s.ID] = true
			if s.Node != "" {
				var node []string
				if json.Unmarshal([]byte(s.Node), &node) != nil || len(node) != 2 || node[0] == "" || node[1] == "" || TrendNodeKey(node[0], node[1]) != s.Node {
					return errors.New("invalid trend node")
				}
			}
		}
	}
	return nil
}

// reduceTrends compares complete, fresh, same-policy domains. A missing domain,
// stale source or selection change is a baseline boundary, not a disappearance.
// Node membership changes update active membership without health transitions.
func reduceTrendGroups(old, next TrendBatch) (TrendBatch, TrendHour) {
	prior := map[string]TrendDomain{}
	for _, d := range old.Domains {
		prior[trendDomainKey(d)] = d
	}
	groups := map[string]*TrendGroup{}
	get := func(kind, key string) *TrendGroup {
		k := trendKey(kind, key)
		g := groups[k]
		if g == nil {
			label := key
			if kind == "nodes" {
				var n []string
				_ = json.Unmarshal([]byte(key), &n)
				if len(n) == 2 {
					label = n[0]
				}
			}
			g = &TrendGroup{Kind: kind, Key: key, Label: label, TrendPoint: TrendPoint{At: next.At.UTC().Truncate(time.Hour), Counts: &TrendCounts{}}}
			groups[k] = g
		}
		return g
	}
	all := get("severity", "all")
	observed := map[*TrendGroup]bool{}
	changesObserved := map[*TrendGroup]bool{}
	changesUnknown := map[*TrendGroup]bool{}
	invalidate := func(g *TrendGroup, reason string) {
		g.Reason = reason
		if reason == "" {
			g.Reason = "source-unavailable"
		}
	}
	add := func(g *TrendGroup, s TrendSignal, change bool) {
		if g.Counts == nil {
			return
		}
		if change {
			g.Counts.Changes++
			return
		}
		switch s.Severity {
		case "high":
			g.Counts.High += max(1, s.Multiplicity)
		case "medium":
			g.Counts.Medium += max(1, s.Multiplicity)
		case "low":
			g.Counts.Low += max(1, s.Multiplicity)
		}
	}
	for i := range next.Domains {
		d := &next.Domains[i]
		p, exists := prior[trendDomainKey(*d)]
		if !d.CachedPopulation && (d.SourceAt.IsZero() || d.SourceAt.After(next.At) || next.At.Sub(d.SourceAt) > 15*time.Minute) {
			d.Complete = false
			d.Reason = "source-unavailable"
		}
		// Decide replay evidence before accumulating coverage; a replay after a gap
		// cannot turn unknown into an observed zero.
		fresh := d.SourceAt.After(p.SourceAt)
		generationKnown := d.Generation != "" && p.Generation != ""
		if generationKnown {
			// Fingerprints are equality tokens, not ordered snapshot clocks.
			fresh = d.Generation != p.Generation
		}
		targets := []*TrendGroup{all, get("rules", d.Rule)}
		if d.Namespace != "" {
			targets = append(targets, get("namespaces", d.Namespace))
		}
		for _, g := range targets {
			if g.SourceAt.IsZero() || (!d.SourceAt.IsZero() && d.SourceAt.Before(g.SourceAt)) {
				g.SourceAt = d.SourceAt
			}
			if !d.Complete {
				invalidate(g, d.Reason)
			}
			if d.BaselineKnown {
				observed[g] = true
			}
		}
		previous := map[string]TrendSignal{}
		for _, s := range p.Signals {
			previous[s.ID] = s
		}
		comparable := exists && p.BaselineKnown && d.Complete && !d.CarriedForward && !p.TransitionsUnknown && !d.TransitionsUnknown && old.Epoch == next.Epoch && p.BaselinePolicy == next.Policy && (generationKnown || !d.SourceAt.Before(p.SourceAt))
		gap := p.Gap || next.At.Sub(p.ObservedAt) > 15*time.Minute || next.Diagnostics.Coalesced > 0 || next.Diagnostics.Overflow > 0
		mark := func(g *TrendGroup) {
			if g.SourceAt.IsZero() || (!d.SourceAt.IsZero() && d.SourceAt.Before(g.SourceAt)) {
				g.SourceAt = d.SourceAt
			}
			if d.ObservedAt.After(g.SampleAt) {
				g.SampleAt = d.ObservedAt
			}
			if d.CarriedForward {
				g.CarriedForward = true
			}
			if comparable && gap {
				changesUnknown[g] = true
			}
		}
		for _, g := range targets {
			mark(g)
		}
		// Scope unknown incarnation to its resource; legacy unkeyed evidence
		// remains conservative rather than inventing replacement events.
		unknownIdentities := map[string]bool{}
		for _, s := range append(append([]TrendSignal(nil), p.Signals...), d.Signals...) {
			if !s.IdentityKnown {
				unknownIdentities[s.IdentityKey] = true
			}
		}
		identityComparable := func(s TrendSignal) bool {
			return comparable && s.IdentityKnown && !unknownIdentities[""] && !unknownIdentities[s.IdentityKey]
		}
		for _, g := range targets {
			if len(unknownIdentities) > 0 {
				changesUnknown[g] = true
			}
			if comparable {
				changesObserved[g] = true
			} else {
				changesUnknown[g] = true
			}
		}
		var oldCounts, newCounts TrendCounts
		if next.transitionTrace != nil {
			oldCounts, newCounts = transitionActive(p.Signals), transitionActive(d.Signals)
		}
		for _, s := range d.Signals {
			ownTargets := append([]*TrendGroup(nil), targets...)
			if s.Node != "" {
				ownTargets = append(ownTargets, get("nodes", s.Node))
			}
			before, found := previous[s.ID]
			changed := identityComparable(s) && fresh && (!found || before.Severity != s.Severity)
			if !changed && (!found || before.Severity != s.Severity || before.Node != s.Node) {
				next.transitionTrace.reject(old, next, p, *d, exists, before, s, found, true, fresh, identityComparable(s), oldCounts, newCounts)
			}
			// Membership is not a health event, but the old node is still observed.
			if found && before.Node != "" && before.Node != s.Node && d.Complete {
				g := get("nodes", before.Node)
				mark(g)
				observed[g] = true
				g.SourceAt = d.SourceAt
				if comparable {
					changesObserved[g] = true
				} else {
					changesUnknown[g] = true
				}
			}
			for _, g := range ownTargets {
				mark(g)
				if !identityComparable(s) {
					changesUnknown[g] = true
				}
				if comparable {
					changesObserved[g] = true
				} else {
					changesUnknown[g] = true
				}
				if !d.Complete {
					invalidate(g, d.Reason)
				}
				if g.SourceAt.IsZero() || (!d.SourceAt.IsZero() && d.SourceAt.Before(g.SourceAt)) {
					g.SourceAt = d.SourceAt
				}
				if d.BaselineKnown {
					observed[g] = true
					add(g, s, false)
				}
				if changed {
					add(g, s, true)
				}
			}
			delete(previous, s.ID)
		}
		for _, s := range previous {
			if !identityComparable(s) || !fresh {
				next.transitionTrace.reject(old, next, p, *d, exists, s, TrendSignal{}, true, false, fresh, identityComparable(s), oldCounts, newCounts)
			}
			ownTargets := append([]*TrendGroup(nil), targets...)
			if s.Node != "" {
				ownTargets = append(ownTargets, get("nodes", s.Node))
			}
			for _, g := range ownTargets {
				mark(g)
				if !identityComparable(s) {
					changesUnknown[g] = true
				}
				if comparable {
					changesObserved[g] = true
				} else {
					changesUnknown[g] = true
				}
				if !d.Complete {
					invalidate(g, d.Reason)
				}
				if d.Complete {
					observed[g] = true
				}
				if identityComparable(s) && fresh {
					add(g, s, true)
				}
			}
		}
		delete(prior, trendDomainKey(*d))
	}
	// Departed domains remain gaps in their historical groups, not artificial zero.
	for _, d := range prior {
		invalidate(all, "selection-changed")
		invalidate(get("rules", d.Rule), "selection-changed")
		if d.Namespace != "" {
			invalidate(get("namespaces", d.Namespace), "selection-changed")
		}
		for _, s := range d.Signals {
			if s.Node != "" {
				invalidate(get("nodes", s.Node), "selection-changed")
			}
		}
	}
	if next.FullProjection && next.Diagnostics.Reasons["dashboard-population-partial"] > 0 {
		for _, g := range groups {
			invalidate(g, "dashboard-population-partial")
			changesUnknown[g] = true
		}
	}
	if next.Diagnostics.CapLosses > 0 || len(next.Domains) == 0 {
		for _, g := range groups {
			invalidate(g, "source-unavailable-or-capped")
		}
	}
	// Unsupported rules are missing contributions, not complete empty domains.
	if !next.FullProjection && len(next.Diagnostics.UnsupportedRules) > 0 {
		for _, g := range groups {
			if g.Kind != "rules" {
				invalidate(g, "unsupported-rules")
				changesUnknown[g] = true
			}
		}
	}
	// Node totals cannot prove all-clear while any selected source domain is missing.
	if all.Reason != "" || next.Diagnostics.Reasons["node-membership-unknown"] > 0 {
		for _, g := range groups {
			if g.Kind == "nodes" {
				invalidate(g, "partial-node-contributions")
			}
		}
	}
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	hour := TrendHour{Epoch: next.Epoch, Policy: next.Policy, At: next.At.UTC().Truncate(time.Hour), Groups: []TrendGroup{}}
	for _, k := range keys {
		g := groups[k]
		g.ConfirmedChanges = g.Counts.Changes
		g.ChangesCoverage = "complete"
		if changesUnknown[g] || g.Reason != "" {
			g.ChangesCoverage = "partial"
		}
		if !changesObserved[g] {
			g.ChangesCoverage = "unknown"
		}
		g.Coverage = "complete"
		if g.Reason != "" {
			g.Coverage = "partial"
		}
		if !observed[g] {
			g.Counts = nil
			g.Coverage = "unknown"
		}
		hour.Groups = append(hour.Groups, *g)
	}
	return next, hour
}
