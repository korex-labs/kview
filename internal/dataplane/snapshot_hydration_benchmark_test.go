package dataplane

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
)

// BenchmarkDemandFirstHydration measures fresh manager -> usable requested rows,
// not process startup or a cold filesystem. Seeding and shutdown are excluded.
// Run explicitly with -run '^$' -bench BenchmarkDemandFirstHydration -benchtime=5x.
func BenchmarkDemandFirstHydration(b *testing.B) {
	for _, cells := range []int{1, 100, 500} {
		b.Run(fmt.Sprintf("cells_%d", cells), func(b *testing.B) {
			b.StopTimer()
			b.Setenv("XDG_CACHE_HOME", b.TempDir())
			sp, err := openBoltSnapshotPersistence("")
			if err != nil {
				b.Fatal(err)
			}
			for i := 0; i < cells; i++ {
				ns := fmt.Sprintf("ns-%04d", i)
				rows := make([]dto.PodListItemDTO, 100)
				for j := range rows {
					rows[j] = dto.PodListItemDTO{Name: fmt.Sprintf("pod-%04d", j), Namespace: ns, Phase: "Running"}
				}
				if err := sp.Save("synthetic", ResourceKindPods, ns, PodsSnapshot{Items: rows, Meta: SnapshotMetadata{ObservedAt: time.Now().UTC().Add(-time.Hour)}}); err != nil {
					b.Fatal(err)
				}
			}
			if err := sp.Close(); err != nil {
				b.Fatal(err)
			}
			policy := DefaultDataplanePolicy()
			policy.Persistence.Enabled = true
			policy.Observers.Enabled = false
			policy.Metrics.Enabled = false
			ns := fmt.Sprintf("ns-%04d", cells-1)
			for i := 0; i < b.N; i++ {
				b.StartTimer()
				m := NewManager(ManagerConfig{Policy: policy}).(*manager)
				plane, err := m.PlaneForCluster(context.Background(), "synthetic")
				if err != nil {
					b.Fatal(err)
				}
				p := plane.(*clusterPlane)
				if err := p.restoreSnapshotCell(context.Background(), ResourceKindPods, ns, true); err != nil {
					b.Fatal(err)
				}
				snap, ok := peekNamespacedSnapshot(&p.podsStore, ns)
				if !ok || len(snap.Items) != 100 || snap.Meta.Freshness != FreshnessClassStale {
					b.Fatal("requested restored rows missing")
				}
				b.StopTimer()
				m.ClosePodsLive()
				if sp := m.currentPersistence(); sp != nil {
					if err := sp.Close(); err != nil {
						b.Fatal(err)
					}
				}
			}
		})
	}
}
