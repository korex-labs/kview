package localhistory

import (
	"context"
	"errors"
)

func (v *Collector) QueryTrends(q TrendQuery) (TrendResponse, error) {
	return v.QueryTrendsContext(context.Background(), q)
}

func (v *Collector) QueryTrendsContext(ctx context.Context, q TrendQuery) (TrendResponse, error) {
	if !v.SignalsEnabled(q.Context) {
		return TrendResponse{}, errors.New("trends consent required")
	}
	out, err := v.store.QueryTrendsContext(ctx, q)
	if err == nil && q.TransitionDetails {
		out.TransitionDiagnostics = v.store.transitionDiagnostics(q.Context, v.config.SignalEpoch)
	}
	return out, err
}

func (v *Collector) SignalsEnabled(name string) bool {
	return v != nil && v.config.Enabled && v.config.SignalHistory && v.config.QueryContext == name
}
