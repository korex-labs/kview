package localhistory

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	bolt "go.etcd.io/bbolt"
)

// This golden is produced by the real durable store, not a hand-written UI DTO.
// The UI parses the same JSON. Set UPDATE_TRENDS_WIRE=1 to regenerate it.
func TestTrendsWireContract(t *testing.T) {
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	node := TrendNodeKey("synthetic-worker", "synthetic-uid")
	baseline := func(at time.Time) TrendBatch {
		return trendFixture(at, TrendSignal{ID: "synthetic-signal", Severity: "high", Node: node})
	}
	first := baseline(start.Add(10 * time.Minute))
	changed := baseline(start.Add(70 * time.Minute))
	changed.Domains[0].Signals[0].Severity = "medium"
	peer := baseline(start.Add(70 * time.Minute))
	peer.Domains[0].Namespace = "peer"
	denied := baseline(start.Add(70 * time.Minute))
	denied.Domains[0].Complete = false
	denied.Domains[0].Reason = "denied"
	unknown := baseline(start.Add(10 * time.Minute))
	unknown.Domains[0].Signals[0].IdentityKnown = false
	unknown.Domains[0].Signals[0].Node = ""
	reset := baseline(start.Add(70 * time.Minute))
	reset.Epoch = "replacement-epoch"
	reset.Domains = nil
	gone := baseline(start.Add(70 * time.Minute))
	gone.Domains[0].Signals = nil
	sameHourChanged := baseline(start.Add(20 * time.Minute))
	sameHourChanged.Domains[0].Signals[0].Severity = "medium"
	sameHourReset := baseline(start.Add(30 * time.Minute))
	sameHourReset.Epoch = "replacement-epoch"
	sameHourReset.Domains = nil
	carriedNode := baseline(start.Add(20 * time.Minute))
	carriedNode.Domains[0].Namespace = "peer"
	carriedNode.Domains[0].Signals[0].Node = ""
	sameHourGone := baseline(start.Add(30 * time.Minute))
	sameHourGone.Domains[0].Signals = nil
	partialBaseline := baseline(start.Add(10 * time.Minute))
	partialChanged := baseline(start.Add(20 * time.Minute))
	partialChanged.Domains[0].Signals[0].Severity = "medium"
	for _, b := range []*TrendBatch{&partialBaseline, &partialChanged} {
		b.Domains[0].Signals[0].IdentityKey = "known-resource"
		b.Domains[0].Signals = append(b.Domains[0].Signals, TrendSignal{ID: "unknown-peer", IdentityKey: "unknown-resource", Severity: "low", Node: node})
	}
	denseChanged := baseline(start.Add(140 * time.Minute))
	denseChanged.Domains[0].Signals[0].Severity = "low"
	denseChanged.Domains[0].Signals[0].IdentityKey = "known-resource"
	denseChanged.Domains[0].Signals = append(denseChanged.Domains[0].Signals,
		TrendSignal{ID: "unknown-peer", IdentityKey: "unknown-resource", Severity: "low", Node: node},
		TrendSignal{ID: "second-known", IdentityKey: "second-resource", IdentityKnown: true, Severity: "high", Node: node})
	cases := []struct {
		name           string
		batches        []TrendBatch
		from, to, asOf time.Time
	}{
		{"persisted-malformed-hour", []TrendBatch{first, sameHourChanged}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"persisted-null-active-confirmed", []TrendBatch{first, sameHourChanged}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"same-hour-epoch-reset", []TrendBatch{first, sameHourChanged, sameHourReset}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"carried-node-disappeared", []TrendBatch{first, carriedNode, sameHourGone}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"partial-confirmed-changes", []TrendBatch{partialBaseline, partialChanged}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"dense-partial-changes", []TrendBatch{partialBaseline, partialChanged, denseChanged}, start.Add(-12 * time.Hour), start.Add(36 * time.Hour), start.Add(150 * time.Minute)},
		{"empty", nil, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"first-baseline", []TrendBatch{first}, start.Add(-time.Hour), start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"predecessor", []TrendBatch{first}, start.Add(time.Hour), start.Add(4 * time.Hour), start.Add(150 * time.Minute)},
		{"changed", []TrendBatch{first, changed}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"unaffected-domain", []TrendBatch{first, peer}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"denied", []TrendBatch{first, denied}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"no-uid", []TrendBatch{unknown}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"epoch-reset", []TrendBatch{first, reset}, start, start.Add(3 * time.Hour), start.Add(150 * time.Minute)},
		{"disappearance", []TrendBatch{first, gone}, start, start.Add(3 * time.Hour), start.Add(90 * time.Minute)},
		{"historical-asof-clamped", []TrendBatch{first}, start, start.Add(time.Hour), start.Add(24 * time.Hour)},
	}
	fixtures := []map[string]any{}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, err := OpenReal(filepath.Join(t.TempDir(), "history.db"), 30)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Close(); err != nil {
					t.Error(err)
				}
			})
			for _, b := range tc.batches {
				if err = s.AppendTrends(b); err != nil {
					t.Fatal(err)
				}
			}
			var persisted []byte
			if tc.name == "persisted-malformed-hour" || tc.name == "persisted-null-active-confirmed" {
				// Model already-written pre-fix bytes, bypassing the corrected writer.
				err = s.db.Update(func(tx *bolt.Tx) error {
					hours := tx.Bucket(trendBucket).Bucket(signalContextKey(first.Context)).Bucket([]byte("hours"))
					var h TrendHour
					if e := json.Unmarshal(hours.Get(stamp(start.Unix())), &h); e != nil {
						return e
					}
					for i := range h.Groups {
						g := &h.Groups[i]
						g.Counts = nil
						g.Coverage = "unknown"
						g.ChangesCoverage = "partial"
						if tc.name == "persisted-malformed-hour" && g.Kind == "severity" {
							g.SampleAt, g.SourceAt = time.Time{}, time.Time{}
						}
					}
					var e error
					persisted, e = json.Marshal(h)
					if e != nil {
						return e
					}
					return hours.Put(stamp(start.Unix()), persisted)
				})
				if err != nil {
					t.Fatal(err)
				}
			}
			q := TrendQuery{Context: "synthetic-a", From: tc.from, To: tc.to, AsOf: tc.asOf}
			q.Normalize()
			response, err := s.QueryTrends(q)
			if err != nil {
				t.Fatal(err)
			}
			if persisted != nil {
				if err = s.db.View(func(tx *bolt.Tx) error {
					raw := tx.Bucket(trendBucket).Bucket(signalContextKey(first.Context)).Bucket([]byte("hours")).Get(stamp(start.Unix()))
					if !bytes.Equal(raw, persisted) {
						t.Fatal("query modified persisted evidence")
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				p := response.Severity[0].Points[0]
				if tc.name == "persisted-malformed-hour" {
					if p.Counts != nil || p.ConfirmedChanges != 0 || !p.SampleAt.IsZero() || p.Reason != "invalid-retained-hour" || len(response.Nodes) != 0 || response.Diagnostics.Reasons["invalid-retained-hour"] != 1 {
						t.Fatal("malformed persisted hour not isolated", p)
					}
				} else if p.Counts != nil || p.ConfirmedChanges != 1 || !p.SampleAt.Equal(sameHourChanged.At) {
					t.Fatal("valid null-active transition evidence lost", p)
				}
			}
			if tc.name == "epoch-reset" && len(response.Nodes) != 0 {
				t.Fatal("old epoch identities entered query")
			}
			if tc.name == "same-hour-epoch-reset" {
				p := response.Severity[0].Points[0]
				if p.Counts != nil || p.ConfirmedChanges != 0 || !p.SampleAt.IsZero() || len(response.Nodes) != 0 {
					t.Fatal("hour compaction leaked old-epoch evidence", p, response.Nodes)
				}
			}
			fixtures = append(fixtures, map[string]any{"name": tc.name, "query": map[string]any{"context": q.Context, "from": q.From, "to": q.To, "rulesMode": q.RulesMode, "nodesMode": q.NodesMode, "namespacesMode": q.NamespacesMode, "rules": []string{}, "nodes": []string{}, "namespaces": []string{}}, "response": response})
		})
	}
	raw, err := json.MarshalIndent(fixtures, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	path := "../../ui/src/components/resources/dashboard/testdata/signalTrends.wire.json"
	if os.Getenv("UPDATE_TRENDS_WIRE") == "1" {
		if err = os.MkdirAll(filepath.Dir(path), 0755); err == nil {
			err = os.WriteFile(path, raw, 0644)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, expected) {
		t.Fatal("store wire contract changed; regenerate and run the UI parser contract test")
	}
}
