package dataplane

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/korex-labs/kview/v5/internal/kube/dto"
	bolt "go.etcd.io/bbolt"
)

func TestPersistenceRetentionExpiresDurableRowsAndLoadedMirrors(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/retention.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Errorf("close persistence: %v", err)
		}
	}()
	now := time.Now().UTC().Truncate(time.Second)
	old := now.Add(-48 * time.Hour).Unix()
	fresh := now.Add(-time.Minute).Unix()
	history := map[string]SignalHistoryRecord{"old": {LastSeenAt: old}, "fresh": {LastSeenAt: fresh}}
	ack := map[string]SignalAcknowledgementRecord{"old": {AcknowledgedAt: old}, "fresh": {AcknowledgedAt: old, UpdatedAt: fresh}}
	expired := SignalSuppressionRecord{Mode: SignalSuppressionModeSnooze, CreatedAt: old, UpdatedAt: old, ExpiresAt: old + 3600, FingerprintVersion: SignalFingerprintVersion}
	active := SignalSuppressionRecord{Mode: SignalSuppressionModeSnooze, CreatedAt: fresh, UpdatedAt: fresh, ExpiresAt: fresh + 3600, FingerprintVersion: SignalFingerprintVersion}
	if err := store.UpsertSignalHistory("unopened", history); err != nil {
		t.Fatal(err)
	}
	for key, rec := range ack {
		if err := store.UpsertSignalAcknowledgement("unopened", key, rec); err != nil {
			t.Fatal(err)
		}
	}
	for key, rec := range map[string]SignalSuppressionRecord{"old": expired, "fresh": active} {
		if err := store.UpsertSignalSuppression("unopened", key, rec); err != nil {
			t.Fatal(err)
		}
	}
	for _, ns := range []string{"old", "fresh"} {
		observed := time.Unix(old, 0)
		if ns == "fresh" {
			observed = time.Unix(fresh, 0)
		}
		snap := PodsSnapshot{Items: []dto.PodListItemDTO{{Name: "api-" + ns, Namespace: ns}}, Meta: SnapshotMetadata{ObservedAt: observed}}
		if err := store.Save("unopened", ResourceKindPods, ns, snap); err != nil {
			t.Fatal(err)
		}
	}
	m := &manager{persistence: store,
		signalHistory:      map[string]map[string]SignalHistoryRecord{"unopened": history},
		signalAck:          map[string]map[string]SignalAcknowledgementRecord{"unopened": ack},
		signalSuppressions: map[string]map[string]SignalSuppressionRecord{"unopened": {"old": expired, "fresh": active}},
	}
	pass := newPersistenceRetentionPass(store, now, 24*time.Hour)
	completed := false
	for turn := 0; turn < 40; turn++ {
		done, err := m.stepPersistenceRetention(pass)
		if err != nil {
			t.Fatal(err)
		}
		if done {
			completed = true
			break
		}
	}
	if !completed {
		t.Fatal("retention did not finish")
	}
	rows, err := store.SearchName("unopened", "api", 10, 0)
	if err != nil || len(rows) != 1 || rows[0].Name != "api-fresh" {
		t.Fatalf("search: %+v, %v", rows, err)
	}
	var snap PodsSnapshot
	if ok, err := store.Load("unopened", ResourceKindPods, "old", &snap); err != nil || ok {
		t.Fatalf("expired snapshot: %v %v", ok, err)
	}
	gotHistory, err := store.LoadSignalHistory("unopened")
	if err != nil || len(gotHistory) != 1 || gotHistory["fresh"].LastSeenAt != fresh {
		t.Fatalf("history: %+v %v", gotHistory, err)
	}
	gotAck, err := store.LoadSignalAcknowledgements("unopened")
	if err != nil || len(gotAck) != 1 || gotAck["fresh"].UpdatedAt != fresh {
		t.Fatalf("ack: %+v %v", gotAck, err)
	}
	gotSuppression, err := store.LoadSignalSuppressions("unopened")
	if err != nil || len(gotSuppression) != 1 || gotSuppression["fresh"] != active {
		t.Fatalf("suppression: %+v %v", gotSuppression, err)
	}
	if len(history) != 1 || len(ack) != 1 || len(m.signalSuppressions["unopened"]) != 1 {
		t.Fatal("already-loaded mirrors retained expired rows")
	}
	if err := store.db.View(func(tx *bolt.Tx) error {
		if tx.Bucket(dataplaneCellIndexBucket).Get(snapshotKey("unopened", ResourceKindPods, "old")) != nil {
			t.Error("expired cell index remains")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPersistenceRetentionOneRecordPerTurnAndLifecycle(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/retention.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Errorf("close persistence: %v", err)
		}
	}()
	now := time.Now().UTC()
	old := now.Add(-48 * time.Hour).Unix()
	if err := store.UpsertSignalHistory("ctx", map[string]SignalHistoryRecord{"a": {LastSeenAt: old}, "b": {LastSeenAt: old}}); err != nil {
		t.Fatal(err)
	}
	m := &manager{persistence: store}
	pass := newPersistenceRetentionPass(store, now, 24*time.Hour)
	pass.bucket = 2
	if done, err := m.stepPersistenceRetention(pass); err != nil || done {
		t.Fatalf("first turn: %v %v", done, err)
	}
	records, err := store.LoadSignalHistory("ctx")
	if err != nil || len(records) != 1 {
		t.Fatalf("one turn removed more than one record: %+v %v", records, err)
	}
	m.snapshotHydration.closed = true
	if done, err := m.stepPersistenceRetention(pass); err != nil || !done {
		t.Fatalf("closed: %v %v", done, err)
	}
	records, err = store.LoadSignalHistory("ctx")
	if err != nil || len(records) != 1 {
		t.Fatalf("closed worker mutated records: %+v %v", records, err)
	}
	m.snapshotHydration.closed = false
	m.persistence = nil
	if done, err := m.stepPersistenceRetention(pass); err != nil || !done {
		t.Fatalf("retired persistence: %v %v", done, err)
	}
}

func TestRetentionExpiryBoundariesAndNewerMirror(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	age := 24 * time.Hour
	cutoff := now.Add(-age).Unix()
	for _, last := range []int64{0, cutoff, cutoff + 1} {
		if signalHistoryExpired(SignalHistoryRecord{LastSeenAt: last}, now, age) {
			t.Fatalf("retained history expired at %d", last)
		}
		if signalAcknowledgementExpired(SignalAcknowledgementRecord{AcknowledgedAt: last}, now, age) {
			t.Fatalf("retained ack expired at %d", last)
		}
	}
	if !signalAcknowledgementExpired(SignalAcknowledgementRecord{AcknowledgedAt: cutoff - 1}, now, age) {
		t.Fatal("legacy ack fallback not expired")
	}
	if signalHistoryExpired(SignalHistoryRecord{LastSeenAt: cutoff - 1}, now, 0) {
		t.Fatal("zero max age must not prune")
	}
	m := &manager{signalHistory: map[string]map[string]SignalHistoryRecord{"ctx": {"key": {LastSeenAt: now.Unix()}}}, signalAck: map[string]map[string]SignalAcknowledgementRecord{"ctx": {"key": {UpdatedAt: now.Unix()}}}}
	m.pruneRetentionMirror(2, signalHistoryKey("ctx", "key"), now, age)
	m.pruneRetentionMirror(3, signalHistoryKey("ctx", "key"), now, age)
	if len(m.signalHistory["ctx"]) != 1 || len(m.signalAck["ctx"]) != 1 {
		t.Fatal("newer mirror publication removed")
	}
	raw, _ := json.Marshal(SignalHistoryRecord{LastSeenAt: cutoff - 1})
	if !retentionRecordExpired(2, nil, raw, now, age) {
		t.Fatal("old history not expired")
	}
	if retentionRecordExpired(2, nil, []byte("invalid"), now, age) {
		t.Fatal("corrupt history must be retained")
	}
	if !retentionRecordExpired(4, []byte("invalid"), []byte("invalid"), now, age) {
		t.Fatal("corrupt suppression must be pruned")
	}
}

func TestSignalRetentionFiltersLazyAndAlreadyLoadedMaps(t *testing.T) {
	store, err := openBoltSnapshotPersistence(t.TempDir() + "/retention.bbolt")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := store.Close(); err != nil {
			t.Errorf("close persistence: %v", err)
		}
	}()
	policy := DefaultDataplanePolicy()
	now := time.Now().UTC().Unix()
	old := time.Now().UTC().Add(-policy.PersistenceMaxAge() - time.Hour).Unix()
	if err := store.UpsertSignalHistory("ctx", map[string]SignalHistoryRecord{"old": {LastSeenAt: old}, "fresh": {LastSeenAt: now}}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertSignalAcknowledgement("ctx", "old", SignalAcknowledgementRecord{AcknowledgedAt: old}); err != nil {
		t.Fatal(err)
	}
	m := &manager{persistence: store, bundle: DataplanePolicyBundle{Global: policy}, signalHistory: map[string]map[string]SignalHistoryRecord{}, signalAck: map[string]map[string]SignalAcknowledgementRecord{}}
	m.ensureSignalHistory("ctx")
	m.ensureSignalAcknowledgements("ctx")
	if len(m.signalHistory["ctx"]) != 1 || len(m.signalAck["ctx"]) != 0 {
		t.Fatal("lazy load retained expired rows")
	}
	m.signalHistory["ctx"]["loaded-old"] = SignalHistoryRecord{LastSeenAt: old}
	m.signalAck["ctx"]["loaded-old"] = SignalAcknowledgementRecord{UpdatedAt: old}
	m.ensureSignalHistory("ctx")
	m.ensureSignalAcknowledgements("ctx")
	if len(m.signalHistory["ctx"]) != 1 || len(m.signalAck["ctx"]) != 0 {
		t.Fatal("already-loaded map retained expired rows")
	}
}
