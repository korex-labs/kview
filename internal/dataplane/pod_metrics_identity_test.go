package dataplane

import (
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

func TestFilterPodMetricsForInstances(t *testing.T) {
	now := time.Unix(1000, 0)
	for _, tt := range []struct {
		name                      string
		podUID, sampleUID         string
		created, captured, window int64
		want                      bool
	}{
		{"matching UID alone", "A", "A", 0, 0, 0, true},
		{"matching UID sample", "A", "A", 100, 200, 30, true},
		{"replacement UID even with newer sample", "B", "A", 100, 200, 30, false},
		{"UID cannot override old sample", "B", "B", 300, 200, 30, false},
		{"UID cannot override overlapping interval", "B", "B", 180, 200, 30, false},
		{"UID-less proven sample", "B", "", 100, 200, 30, true},
		{"creation evidence without pod UID", "", "", 100, 200, 30, true},
		{"UID-less old sample", "B", "", 300, 200, 30, false},
		{"sample overlaps creation", "B", "", 180, 200, 30, false},
		{"equal interval boundary ambiguous", "B", "", 170, 200, 30, false},
		{"same second ambiguous", "B", "", 200, 200, 0, false},
		{"missing creation", "B", "", 0, 200, 30, false},
		{"frozen age cannot prove creation", "", "", 0, 200, 30, false},
		{"missing sample time", "B", "", 100, 0, 30, false},
		{"missing sample window", "B", "", 100, 200, 0, false},
		{"negative sample window", "B", "B", 100, 200, -1, false},
		{"negative sample time", "B", "B", 100, -1, 30, false},
		{"future sample", "B", "B", 100, 1001, 30, false},
		{"oversized sample window", "B", "B", 100, 200, 1 << 62, false},
		{"no evidence", "", "", 0, 0, 0, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			pods := []dto.PodListItemDTO{{UID: tt.podUID, Name: "p", Namespace: "ns", CreatedAt: tt.created, AgeSec: 999}}
			samples := []dto.PodMetricsDTO{{UID: tt.sampleUID, Name: "p", Namespace: "ns", CapturedAt: tt.captured, WindowSec: tt.window}}
			got := FilterPodMetricsForInstances(pods, samples, now)
			if (len(got) == 1) != tt.want {
				t.Fatalf("accepted=%v want=%v: %+v", len(got) == 1, tt.want, got)
			}
			samples[0].Namespace = "other"
			if len(FilterPodMetricsForInstances(pods, samples, now)) != 0 {
				t.Fatal("cross-namespace join")
			}
			samples[0].Namespace = "ns"
			samples[0].Name = "other"
			if len(FilterPodMetricsForInstances(pods, samples, now)) != 0 {
				t.Fatal("cross-name join")
			}
		})
	}
}
