package localhistory

import (
	"encoding/json"
	"time"
)

const TransitionRecentLimit = 128
const TransitionRecentMaxBytes = 256 << 10

// TransitionDiagnostics is process-local evidence, not retained event history.
// Counters count rejected candidates, never inferred changes or resolved signals.
// Queue loss counters describe observation coverage, not a per-resource cause.
type TransitionDiagnostics struct {
	Context     string                `json:"context"`
	Epoch       string                `json:"epoch"`
	AcceptedAt  time.Time             `json:"acceptedAt"`
	Reasons     map[string]uint64     `json:"reasons"`
	Coalesced   uint64                `json:"coalesced"`
	Overflow    uint64                `json:"overflow"`
	Evicted     uint64                `json:"evicted"`
	Recent      []TransitionRejection `json:"recent"`
	recentBytes int
}
type TransitionRejection struct {
	At                time.Time             `json:"at"`
	Namespace         string                `json:"namespace"`
	Rule              string                `json:"rule"`
	Reason            string                `json:"reason"`
	Candidate         string                `json:"candidate"`
	Decision          string                `json:"decision"`
	Old               TransitionObservation `json:"old"`
	New               TransitionObservation `json:"new"`
	PolicyChanged     bool                  `json:"policyChanged"`
	GenerationChanged bool                  `json:"generationChanged"`
}
type TransitionObservation struct {
	Active        TrendCounts `json:"active"`
	SourceAt      time.Time   `json:"sourceAt"`
	EvaluatedAt   time.Time   `json:"evaluatedAt"`
	SourceStatus  string      `json:"sourceStatus"`
	IdentityKnown bool        `json:"identityKnown"`
	ResourceUID   string      `json:"resourceUID,omitempty"`
	Node          string      `json:"node,omitempty"`
	Severity      string      `json:"severity,omitempty"`
	Present       bool        `json:"present"`
}

func validTransitionSourceStatus(s string) bool {
	switch s {
	case "", "available", "source-missing", "source-restored", "source-error", "source-partial", "source-stale", "source-clock", "source-unknown", "identity-compacted", "domain-not-observed", "source-replay":
		return true
	}
	return false
}
func transitionSourceStatus(d TrendDomain) string {
	if d.SourceStatus != "" {
		return d.SourceStatus
	}
	if d.TransitionsUnknown || !d.Complete {
		return "source-unknown"
	}
	return "available"
}
func cloneTransitionDiagnostics(in *TransitionDiagnostics, name, epoch string) *TransitionDiagnostics {
	out := &TransitionDiagnostics{Context: name, Epoch: epoch, Reasons: map[string]uint64{}, Recent: []TransitionRejection{}}
	if in == nil || in.Context != name || in.Epoch != epoch {
		return out
	}
	*out = *in
	out.Reasons = make(map[string]uint64, len(in.Reasons))
	for k, v := range in.Reasons {
		out.Reasons[k] = v
	}
	out.Recent = append([]TransitionRejection{}, in.Recent...)
	return out
}
func (s *Store) transitionDiagnostics(name, epoch string) *TransitionDiagnostics {
	s.transitionMu.Lock()
	defer s.transitionMu.Unlock()
	return cloneTransitionDiagnostics(s.transitions[name], name, epoch)
}

// Capture an attempted delta before the incremental gate carries the previous
// baseline forward. Unchanged failed observations do not create candidate spam.
func (t *TransitionDiagnostics) rejectAttempt(old, next TrendBatch, p, d TrendDomain, exists, fresh bool) {
	previous := make(map[string]TrendSignal, len(p.Signals))
	for _, s := range p.Signals {
		previous[s.ID] = s
	}
	oldCounts, newCounts := transitionActive(p.Signals), transitionActive(d.Signals)
	for _, s := range d.Signals {
		before, found := previous[s.ID]
		if !found || before.Severity != s.Severity || before.Node != s.Node {
			t.reject(old, next, p, d, exists, before, s, found, true, fresh, false, oldCounts, newCounts)
		}
		delete(previous, s.ID)
	}
	for _, s := range previous {
		t.reject(old, next, p, d, exists, s, TrendSignal{}, true, false, fresh, false, oldCounts, newCounts)
	}
}
func transitionActive(signals []TrendSignal) TrendCounts {
	var c TrendCounts
	for _, s := range signals {
		switch s.Severity {
		case "high":
			c.High += max(1, s.Multiplicity)
		case "medium":
			c.Medium += max(1, s.Multiplicity)
		case "low":
			c.Low += max(1, s.Multiplicity)
		}
	}
	return c
}
func transitionObservation(d TrendDomain, s TrendSignal, present bool, counts TrendCounts) TransitionObservation {
	sourceAt := d.SourceAt
	if d.SourceStatus != "" {
		sourceAt = d.EvidenceAt
	}
	return TransitionObservation{Active: counts, SourceAt: sourceAt, EvaluatedAt: d.ObservedAt, SourceStatus: transitionSourceStatus(d), IdentityKnown: s.IdentityKnown, ResourceUID: s.ResourceUID, Node: s.Node, Severity: s.Severity, Present: present}
}
func (t *TransitionDiagnostics) reject(old, next TrendBatch, p, d TrendDomain, exists bool, before, after TrendSignal, had, has, fresh, identityComparable bool, oldCounts, newCounts TrendCounts) {
	if t == nil {
		return
	}
	reason := "source-unknown"
	switch {
	case old.Epoch != "" && old.Epoch != next.Epoch:
		reason = "epoch-rebase"
	case !exists || !p.BaselineKnown:
		reason = "no-previous-baseline"
	case p.BaselinePolicy != next.Policy:
		reason = "policy-rebase"
	case d.TransitionsUnknown || !d.Complete || d.CarriedForward:
		reason = transitionSourceStatus(d)
	case p.TransitionsUnknown:
		reason = "previous-source-unavailable"
	case !identityComparable:
		reason = "missing-uid"
	case !fresh:
		reason = "source-replay"
	case had && has && before.Severity == after.Severity && before.Node != after.Node:
		reason = "membership-only"
	}
	candidate := "severity-candidate"
	if !had {
		candidate = "appearance-candidate"
	} else if !has {
		candidate = "disappearance-candidate"
	} else if before.Severity == after.Severity {
		candidate = "membership-only"
	}
	r := TransitionRejection{At: next.At, Namespace: d.Namespace, Rule: d.Rule, Reason: reason, Candidate: candidate, Decision: "not-confirmed", Old: transitionObservation(p, before, had, oldCounts), New: transitionObservation(d, after, has, newCounts), PolicyChanged: old.Policy != "" && old.Policy != next.Policy, GenerationChanged: p.Generation != d.Generation}
	t.Reasons[reason]++
	raw, _ := json.Marshal(r)
	// Both record count and encoded size are hard bounds. No native objects,
	// messages, policy hashes, signal fingerprints or arbitrary errors enter here.
	if len(raw)+2 > TransitionRecentMaxBytes {
		t.Evicted++
		return
	}
	for len(t.Recent) > 0 && (len(t.Recent) >= TransitionRecentLimit || t.recentBytes+len(raw)+3 > TransitionRecentMaxBytes) {
		previous, _ := json.Marshal(t.Recent[0])
		t.recentBytes -= len(previous) + 1
		copy(t.Recent, t.Recent[1:])
		t.Recent[len(t.Recent)-1] = TransitionRejection{}
		t.Recent = t.Recent[:len(t.Recent)-1]
		t.Evicted++
	}
	t.Recent = append(t.Recent, r)
	t.recentBytes += len(raw) + 1
}
