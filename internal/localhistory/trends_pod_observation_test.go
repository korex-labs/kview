package localhistory

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

func TestTransitionPodObservationLimitExpiryAndEpoch(t *testing.T) {
	s, _ := trendStore(t, 30)
	batch := trendFixture(epoch)
	batch.FullProjection = true
	batch.Domains = nil
	for i := 0; i < 2*PodObservationLimit; i++ {
		batch.PodObservationScopes = append(batch.PodObservationScopes, fmt.Sprintf("ns-%03d", i))
	}
	calls := 0
	batch.CapturePodObservation = func(string) PodObservation {
		calls++
		return PodObservation{PodCapture: PodCapture{At: batch.At, Membership: "listed"}}
	}
	appendBatch := func() {
		t.Helper()
		if err := s.AppendTrends(batch); err != nil {
			t.Fatal(err)
		}
	}
	appendBatch()
	if calls != PodObservationLimit {
		t.Fatal("unbounded captures", calls)
	}
	current := func() TrendBatch {
		t.Helper()
		var state TrendBatch
		if err := s.db.View(func(tx *bolt.Tx) error {
			return json.Unmarshal(tx.Bucket(trendBucket).Bucket(signalContextKey(batch.Context)).Get([]byte("current")), &state)
		}); err != nil {
			t.Fatal(err)
		}
		return state
	}
	state := current()
	if len(state.PodObservations) != PodObservationLimit || len(state.Domains) != 0 {
		t.Fatal("sample changed population or exceeded cap")
	}
	batch.At = epoch.Add(time.Hour)
	batch.Epoch = "new-epoch"
	appendBatch()
	state = current()
	if o := state.PodObservations["ns-000"]; o == nil || o.FirstRetainedGap == nil || !o.FirstRetainedGap.At.Equal(batch.At) {
		t.Fatal("old-epoch evidence carried across")
	}
	if err := s.pruneTrends(batch.At.Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if len(current().PodObservations) != 0 {
		t.Fatal("expired observation retained without domain")
	}
}
