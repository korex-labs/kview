package dataplane

import (
	"github.com/korex-labs/kview/v5/internal/localhistory"
	"sort"
	"time"
)

// All lookups are in the immutable per-store capture used by this projection.
// Never enumerate the Pods map: its keys are not namespace authorization.
func podObservationCapture(names []string, catalog NamespaceSnapshot, pods map[string]PodsSnapshot, at time.Time) func(string) localhistory.PodObservation {
	list := observationCell(catalog, at)
	return func(ns string) localhistory.PodObservation {
		membership := "unknown"
		i := sort.SearchStrings(names, ns)
		if i < len(names) && names[i] == ns {
			membership = "listed"
		} else if list.Status == "available" {
			membership = "absent"
		}
		pod, ok := pods[ns]
		return localhistory.PodObservation{PodCapture: localhistory.PodCapture{At: at, Membership: membership, Catalog: list, Pods: observationCell(pod, at), PodsPresent: ok}}
	}
}

func observationCell[I any](s Snapshot[I], at time.Time) localhistory.ObservationCell {
	_, valid := historyPublishedMetadata(s)
	status := "available"
	switch {
	case s.Err != nil:
		status = "source-error"
	case s.Meta.ObservedAt.IsZero():
		status = "source-missing"
	case s.restored:
		status = "source-restored"
	case s.Meta.ObservedAt.After(at):
		status = "source-clock"
	case at.Sub(s.Meta.ObservedAt) > 15*time.Minute || s.Meta.Freshness != FreshnessClassHot:
		status = "source-stale"
	case !valid:
		status = "source-partial"
	}
	return localhistory.ObservationCell{Status: status, Revision: s.Meta.Revision, ObservedAt: s.Meta.ObservedAt}
}
