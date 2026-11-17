package localhistory

import (
	"encoding/json"
	"slices"
	"time"
)

const TransitionHourGroupLimit = 128
const TransitionHourExampleLimit = 8
const TransitionHourMaxBytes = 64 << 10

// TransitionHourEvidence summarizes decisions, not incidents. Reasons are
// whole-hour candidate counters; Groups are optionally query-filtered. Domain
// counts in examples are observed populations, not a claim of causal attribution.
// TruncatedCandidates counts candidates with omitted group attribution (once per
// omitted node attribution); ExamplesOmitted counts omitted detailed examples.
type TransitionHourEvidence struct {
	// Earlier appends in this hour lacked retained evidence (old writer or cap).
	Incomplete          bool                    `json:"incomplete,omitempty"`
	At                  time.Time               `json:"at"`
	Epoch               string                  `json:"epoch"`
	Reasons             map[string]uint64       `json:"reasons"`
	Groups              []TransitionReasonGroup `json:"groups"`
	Examples            []TransitionRejection   `json:"examples,omitempty"`
	TruncatedCandidates uint64                  `json:"truncatedCandidates"`
	ExamplesOmitted     uint64                  `json:"examplesOmitted"`
	// Queue counters are coverage observations, never candidate rejection causes.
	Coalesced uint64 `json:"coalesced,omitempty"`
	Overflow  uint64 `json:"overflow,omitempty"`
}
type TransitionReasonGroup struct {
	Namespace    string            `json:"namespace"`
	Rule         string            `json:"rule"`
	Node         string            `json:"node,omitempty"`
	Reasons      map[string]uint64 `json:"reasons"`
	LastAt       time.Time         `json:"lastAt"`
	DomainBefore TrendCounts       `json:"domainBefore"`
	DomainAfter  TrendCounts       `json:"domainAfter"`
}

func newTransitionHour(at time.Time, epoch string) *TransitionHourEvidence {
	return &TransitionHourEvidence{At: at.UTC().Truncate(time.Hour), Epoch: epoch, Reasons: map[string]uint64{}, Groups: []TransitionReasonGroup{}}
}
func (h *TransitionHourEvidence) addGroup(in TransitionReasonGroup) {
	ns, rule, node, reasons := in.Namespace, in.Rule, in.Node, in.Reasons
	for i := range h.Groups {
		g := &h.Groups[i]
		if g.Namespace == ns && g.Rule == rule && g.Node == node {
			for reason, n := range reasons {
				g.Reasons[reason] += n
			}
			if !in.LastAt.Before(g.LastAt) {
				g.LastAt, g.DomainBefore, g.DomainAfter = in.LastAt, in.DomainBefore, in.DomainAfter
			}
			return
		}
	}
	if len(h.Groups) >= TransitionHourGroupLimit {
		for _, n := range reasons {
			h.TruncatedCandidates += n
		}
		return
	}
	copied := make(map[string]uint64, len(reasons))
	for reason, n := range reasons {
		copied[reason] = n
	}
	in.Reasons = copied
	h.Groups = append(h.Groups, in)
}
func (h *TransitionHourEvidence) record(r TransitionRejection) {
	if h == nil {
		return
	}
	h.Reasons[r.Reason]++
	reasons := map[string]uint64{r.Reason: 1}
	node := r.New.Node
	if node == "" {
		node = r.Old.Node
	}
	g := TransitionReasonGroup{Namespace: r.Namespace, Rule: r.Rule, Node: node, Reasons: reasons, LastAt: r.At, DomainBefore: r.Old.Active, DomainAfter: r.New.Active}
	h.addGroup(g)
	if r.Old.Node != "" && r.Old.Node != node {
		g.Node = r.Old.Node
		h.addGroup(g)
	}
	if len(h.Examples) < TransitionHourExampleLimit {
		h.Examples = append(h.Examples, r)
	} else {
		h.ExamplesOmitted++
	}
}

// Merge before serialization in the same transaction as the aggregate. Existing
// admissions win; counts survive example eviction and do not net-cancel.
func mergeTransitionHours(prior, next *TransitionHourEvidence) *TransitionHourEvidence {
	if next == nil {
		return prior
	}
	if prior == nil || prior.Epoch != next.Epoch || !prior.At.Equal(next.At) {
		prior = newTransitionHour(next.At, next.Epoch)
	}
	prior.Incomplete = prior.Incomplete || next.Incomplete
	for reason, n := range next.Reasons {
		prior.Reasons[reason] += n
	}
	for _, g := range next.Groups {
		prior.addGroup(g)
	}
	prior.TruncatedCandidates += next.TruncatedCandidates
	prior.ExamplesOmitted += next.ExamplesOmitted
	prior.Coalesced = max(prior.Coalesced, next.Coalesced)
	prior.Overflow = max(prior.Overflow, next.Overflow)
	for _, r := range next.Examples {
		if len(prior.Examples) < TransitionHourExampleLimit {
			prior.Examples = append(prior.Examples, r)
		} else {
			prior.ExamplesOmitted++
		}
	}
	return fitTransitionHour(prior, TransitionHourMaxBytes)
}

// Drop optional attribution before it can displace canonical history. If even
// the summary cannot fit, absence means unavailable, never confirmed zero.
func fitTransitionHour(prior *TransitionHourEvidence, budget int) *TransitionHourEvidence {
	if prior == nil {
		return nil
	}
	// Exact JSON bound, including escaped identifiers and counters. Leave an
	// explicit attribution-loss count rather than pretending the retained sample
	// explains the whole population. Whole-hour fixed-vocabulary counters survive.
	for {
		raw, _ := json.Marshal(prior)
		if len(raw) <= budget {
			return prior
		}
		if n := len(prior.Examples); n > 0 {
			prior.Examples = prior.Examples[:n-1]
			prior.ExamplesOmitted++
			continue
		}
		if n := len(prior.Groups); n > 0 {
			for _, count := range prior.Groups[n-1].Reasons {
				prior.TruncatedCandidates += count
			}
			prior.Groups = prior.Groups[:n-1]
			continue
		}
		return nil // no room even for the summary; do not reject canonical data
	}
}
func transitionSelection(q TrendQuery, ns, rule, node string) bool {
	return (len(q.Namespaces) == 0 || slices.Contains(q.Namespaces, ns)) && (len(q.Rules) == 0 || slices.Contains(q.Rules, rule)) && (len(q.Nodes) == 0 || slices.Contains(q.Nodes, node))
}
func filterTransitionHour(h *TransitionHourEvidence, q TrendQuery) {
	groups := h.Groups[:0]
	for _, g := range h.Groups {
		if transitionSelection(q, g.Namespace, g.Rule, g.Node) {
			groups = append(groups, g)
		}
	}
	h.Groups = groups
	examples := h.Examples[:0]
	for _, r := range h.Examples {
		if transitionSelection(q, r.Namespace, r.Rule, r.New.Node) || transitionSelection(q, r.Namespace, r.Rule, r.Old.Node) {
			examples = append(examples, r)
		}
	}
	h.Examples = examples
}
