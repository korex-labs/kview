package localhistory

import "time"

// projectTrendPoint never consults current state. A historical hour represents
// its last observation, not a claim about the beginning of that hour.
func projectTrendPoint(at, asOf time.Time, previous, point TrendPoint, present bool, retention time.Duration) TrendPoint {
	empty := TrendPoint{At: at, Reason: "no-sample", Coverage: "unknown", ChangesCoverage: "unknown", Freshness: "unknown"}
	if !at.Before(asOf) {
		return empty
	}
	end := at.Add(time.Hour)
	if end.After(asOf) {
		end = asOf
	}
	if present && !point.SampleAt.After(end) {
		if point.ChangesCoverage == "" {
			point.ChangesCoverage = "unknown"
		}
		if point.Coverage == "" {
			point.Coverage = "unknown"
		}
		decorateTrendPoint(&point, end)
		return point
	}
	if previous.Counts == nil || previous.SampleAt.IsZero() || previous.SampleAt.After(at) || previous.SourceAt.IsZero() || end.Sub(previous.SourceAt) > retention {
		return empty
	}
	p := previous
	counts := *p.Counts
	counts.Changes = 0
	p.Counts = &counts
	p.At = at
	p.ConfirmedChanges = 0
	p.CarriedForward = true
	p.Coverage = "partial"
	p.ChangesCoverage = "unknown"
	p.Reason = "last-observed"
	decorateTrendPoint(&p, end)
	return p
}
