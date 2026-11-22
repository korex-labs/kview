package localhistory

import "time"

const PodObservationLimit = 64

type ObservationCell struct {
	Status     string    `json:"status"`
	Revision   uint64    `json:"revision,omitempty"`
	ObservedAt time.Time `json:"observedAt,omitzero"`
}

type PodCapture struct {
	At          time.Time       `json:"at"`
	Membership  string          `json:"membership"`
	Catalog     ObservationCell `json:"catalog"`
	Pods        ObservationCell `json:"pods"`
	PodsPresent bool            `json:"podsPresent"`
	Domain      string          `json:"domain"`
	DomainAt    time.Time       `json:"domainAt,omitzero"`
}

type PodObservation struct {
	PodCapture
	BeforeGap        *PodCapture `json:"beforeGap,omitempty"`
	FirstRetainedGap *PodCapture `json:"firstRetainedGap,omitempty"`
}

func (p *PodObservation) clone() *PodObservation {
	if p == nil {
		return nil
	}
	c := *p
	if p.FirstRetainedGap != nil {
		gap := *p.FirstRetainedGap
		c.FirstRetainedGap = &gap
	}
	if p.BeforeGap != nil {
		before := *p.BeforeGap
		c.BeforeGap = &before
	}
	return &c
}

// The existing ordered, capped domain pass supplies previously authorized scopes;
// the bounded catalog prefix also covers listed scopes with no Pod baseline yet.
func (b *TrendBatch) capturePodObservations(old TrendBatch, incoming map[string]TrendDomain, keys []string) {
	b.PodObservations = nil
	if b.CapturePodObservation == nil || !b.FullProjection {
		return
	}
	b.PodObservations = make(map[string]*PodObservation)
	add := func(ns string) {
		if ns == "" || len(ns) > 253 || b.PodObservations[ns] != nil || len(b.PodObservations) >= PodObservationLimit {
			return
		}
		obs := b.CapturePodObservation(ns)
		d, ok := incoming[trendKey(ns, "pod_image_pull_failure")]
		obs.Domain = "omitted"
		if ok && d.Generation != "canonical-empty" {
			obs.Domain = transitionSourceStatus(d)
			obs.DomainAt = d.EvidenceAt
		}
		if obs.Domain != "available" {
			prior := old.PodObservations[ns]
			if prior != nil && prior.FirstRetainedGap != nil {
				obs.FirstRetainedGap = prior.FirstRetainedGap
				obs.BeforeGap = prior.BeforeGap
			} else {
				if prior != nil && prior.Domain == "available" {
					before := prior.PodCapture
					obs.BeforeGap = &before
				}
				first := obs.PodCapture
				obs.FirstRetainedGap = &first
			}
		}
		b.PodObservations[ns] = &obs
	}
	for _, key := range keys {
		d := incoming[key]
		if d.Rule == "pod_image_pull_failure" {
			add(d.Namespace)
		}
		if len(b.PodObservations) == PodObservationLimit {
			break
		}
	}
	for _, ns := range b.PodObservationScopes[:min(len(b.PodObservationScopes), PodObservationLimit)] {
		add(ns)
	}
}
