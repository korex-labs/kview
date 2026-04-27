package dataplane

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

const searchKeySeparator = "\x00"

var (
	dataplaneSnapshotBucket  = []byte("snapshots_v1")
	dataplaneSearchBucket    = []byte("search_name_v1")
	dataplaneCellIndexBucket = []byte("search_cell_v1")
	dataplaneSignalBucket    = []byte("signals_v1")
	dataplaneMetaBucket      = []byte("meta")
	dataplaneSchemaKey       = []byte("schemaVersion")
)

const (
	dataplaneSchemaVersionV1      = 1
	dataplaneSchemaVersionCurrent = 2
)

type persistenceMigrationStatus struct {
	FromVersion int
	ToVersion   int
	Applied     bool
}

type snapshotPersistence interface {
	MigrationStatus() persistenceMigrationStatus
	Load(cluster string, kind ResourceKind, namespace string, into any) (bool, error)
	Save(cluster string, kind ResourceKind, namespace string, snap any) error
	Delete(cluster string, kind ResourceKind, namespace string) error
	PruneOlderThan(cluster string, maxAge time.Duration) error
	ListSnapshots(cluster string) ([]persistedSnapshotCell, error)
	SearchName(cluster string, query string, limit int, offset int) ([]dataplaneSearchRow, error)
	LoadSignalHistory(cluster string) (map[string]signalHistoryRecord, error)
	UpsertSignalHistory(cluster string, updates map[string]signalHistoryRecord) error
	PruneSignalHistoryOlderThan(cluster string, maxAge time.Duration) error
	Close() error
}

type boltSnapshotPersistence struct {
	db              *bolt.DB
	migrationStatus persistenceMigrationStatus
}

func defaultDataplanePersistencePath() string {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "kview", "dataplane-cache.bbolt")
}

func openBoltSnapshotPersistence(path string) (*boltSnapshotPersistence, error) {
	if path == "" {
		path = defaultDataplanePersistencePath()
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, err
	}
	migrationStatus, err := migrateBoltPersistenceIfNeeded(db)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		return ensureDataplaneBuckets(tx)
	}); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &boltSnapshotPersistence{db: db, migrationStatus: migrationStatus}, nil
}

func (p *boltSnapshotPersistence) MigrationStatus() persistenceMigrationStatus {
	if p == nil {
		return persistenceMigrationStatus{}
	}
	return p.migrationStatus
}

func migrateBoltPersistenceIfNeeded(db *bolt.DB) (persistenceMigrationStatus, error) {
	status := persistenceMigrationStatus{}
	err := db.Update(func(tx *bolt.Tx) error {
		current, err := readDataplaneSchemaVersion(tx)
		if err != nil {
			return err
		}
		status.FromVersion = current
		if current >= dataplaneSchemaVersionCurrent {
			status.ToVersion = current
			return ensureDataplaneBuckets(tx)
		}
		if current <= 0 {
			current = dataplaneSchemaVersionV1
		}
		for current < dataplaneSchemaVersionCurrent {
			next := current + 1
			if err := runDataplaneMigrationStep(tx, current, next); err != nil {
				return err
			}
			current = next
		}
		status.ToVersion = current
		status.Applied = status.ToVersion != status.FromVersion
		return nil
	})
	if err != nil {
		return persistenceMigrationStatus{}, err
	}
	return status, nil
}

func readDataplaneSchemaVersion(tx *bolt.Tx) (int, error) {
	mb := tx.Bucket(dataplaneMetaBucket)
	if mb != nil {
		raw := mb.Get(dataplaneSchemaKey)
		if len(raw) > 0 {
			var version int
			if err := json.Unmarshal(raw, &version); err != nil {
				return 0, fmt.Errorf("decode dataplane schema version: %w", err)
			}
			return version, nil
		}
	}
	if hasAnyDataplaneV1Bucket(tx) {
		return dataplaneSchemaVersionV1, nil
	}
	return 0, nil
}

func hasAnyDataplaneV1Bucket(tx *bolt.Tx) bool {
	for _, bucket := range [][]byte{dataplaneSnapshotBucket, dataplaneSearchBucket, dataplaneCellIndexBucket, dataplaneSignalBucket} {
		if tx.Bucket(bucket) != nil {
			return true
		}
	}
	return false
}

func runDataplaneMigrationStep(tx *bolt.Tx, fromVersion int, toVersion int) error {
	switch {
	case fromVersion == dataplaneSchemaVersionV1 && toVersion == dataplaneSchemaVersionCurrent:
		if err := ensureDataplaneBuckets(tx); err != nil {
			return err
		}
		return writeDataplaneSchemaVersion(tx, toVersion)
	case fromVersion == 0 && toVersion == dataplaneSchemaVersionV1:
		if err := ensureDataplaneBuckets(tx); err != nil {
			return err
		}
		return writeDataplaneSchemaVersion(tx, toVersion)
	default:
		return fmt.Errorf("unsupported dataplane cache migration: %d -> %d", fromVersion, toVersion)
	}
}

func writeDataplaneSchemaVersion(tx *bolt.Tx, version int) error {
	mb, err := tx.CreateBucketIfNotExists(dataplaneMetaBucket)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(version)
	if err != nil {
		return err
	}
	return mb.Put(dataplaneSchemaKey, payload)
}

func ensureDataplaneBuckets(tx *bolt.Tx) error {
	for _, bucket := range [][]byte{dataplaneSnapshotBucket, dataplaneSearchBucket, dataplaneCellIndexBucket, dataplaneSignalBucket} {
		if _, err := tx.CreateBucketIfNotExists(bucket); err != nil {
			return err
		}
	}
	mb, err := tx.CreateBucketIfNotExists(dataplaneMetaBucket)
	if err != nil {
		return err
	}
	if mb.Get(dataplaneSchemaKey) == nil {
		if err := writeDataplaneSchemaVersion(tx, dataplaneSchemaVersionCurrent); err != nil {
			return err
		}
	}
	return nil
}

func (p *boltSnapshotPersistence) Close() error {
	if p == nil || p.db == nil {
		return nil
	}
	return p.db.Close()
}

func (p *boltSnapshotPersistence) Load(cluster string, kind ResourceKind, namespace string, into any) (bool, error) {
	if p == nil || p.db == nil {
		return false, nil
	}
	key := snapshotKey(cluster, kind, namespace)
	var payload []byte
	err := p.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSnapshotBucket)
		if b == nil {
			return nil
		}
		raw := b.Get(key)
		if raw == nil {
			return nil
		}
		payload = append([]byte(nil), raw...)
		return nil
	})
	if err != nil || payload == nil {
		return false, err
	}
	if err := json.Unmarshal(payload, into); err != nil {
		return false, err
	}
	return true, nil
}

func (p *boltSnapshotPersistence) Save(cluster string, kind ResourceKind, namespace string, snap any) error {
	if p == nil || p.db == nil {
		return nil
	}
	payload, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	cellKey := snapshotKey(cluster, kind, namespace)
	rows := searchRowsFromSnapshot(cluster, kind, namespace, snap)
	return p.db.Update(func(tx *bolt.Tx) error {
		snapshots, err := tx.CreateBucketIfNotExists(dataplaneSnapshotBucket)
		if err != nil {
			return err
		}
		search, err := tx.CreateBucketIfNotExists(dataplaneSearchBucket)
		if err != nil {
			return err
		}
		cells, err := tx.CreateBucketIfNotExists(dataplaneCellIndexBucket)
		if err != nil {
			return err
		}
		if err := snapshots.Put(cellKey, payload); err != nil {
			return err
		}
		if err := deleteCellIndex(search, cells, cellKey); err != nil {
			return err
		}
		indexKeys := make([][]byte, 0, len(rows))
		for _, row := range rows {
			key := searchIndexKey(row)
			value, err := json.Marshal(row)
			if err != nil {
				return err
			}
			if err := search.Put(key, value); err != nil {
				return err
			}
			indexKeys = append(indexKeys, key)
		}
		cellPayload, err := json.Marshal(indexKeys)
		if err != nil {
			return err
		}
		return cells.Put(cellKey, cellPayload)
	})
}

func (p *boltSnapshotPersistence) Delete(cluster string, kind ResourceKind, namespace string) error {
	if p == nil || p.db == nil {
		return nil
	}
	cellKey := snapshotKey(cluster, kind, namespace)
	return p.db.Update(func(tx *bolt.Tx) error {
		snapshots := tx.Bucket(dataplaneSnapshotBucket)
		search := tx.Bucket(dataplaneSearchBucket)
		cells := tx.Bucket(dataplaneCellIndexBucket)
		if snapshots != nil {
			if err := snapshots.Delete(cellKey); err != nil {
				return err
			}
		}
		if search != nil && cells != nil {
			return deleteCellIndex(search, cells, cellKey)
		}
		return nil
	})
}

func (p *boltSnapshotPersistence) PruneOlderThan(cluster string, maxAge time.Duration) error {
	if p == nil || p.db == nil || maxAge <= 0 {
		return nil
	}
	cutoff := time.Now().UTC().Add(-maxAge)
	return p.db.Update(func(tx *bolt.Tx) error {
		snapshots := tx.Bucket(dataplaneSnapshotBucket)
		search := tx.Bucket(dataplaneSearchBucket)
		cells := tx.Bucket(dataplaneCellIndexBucket)
		if snapshots == nil {
			return nil
		}
		var deleteKeys [][]byte
		if err := snapshots.ForEach(func(key, value []byte) error {
			keyCluster, _, _, ok := decodeSnapshotKey(key)
			if !ok || (cluster != "" && keyCluster != cluster) {
				return nil
			}
			observed, ok := persistedSnapshotObservedAt(value)
			if !ok || observed.IsZero() || !observed.Before(cutoff) {
				return nil
			}
			deleteKeys = append(deleteKeys, append([]byte(nil), key...))
			return nil
		}); err != nil {
			return err
		}
		for _, key := range deleteKeys {
			if err := snapshots.Delete(key); err != nil {
				return err
			}
			if search != nil && cells != nil {
				if err := deleteCellIndex(search, cells, key); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

type persistedSnapshotCell struct {
	Kind      ResourceKind
	Namespace string
	Payload   []byte
}

func (p *boltSnapshotPersistence) ListSnapshots(cluster string) ([]persistedSnapshotCell, error) {
	if p == nil || p.db == nil {
		return nil, nil
	}
	var cells []persistedSnapshotCell
	err := p.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSnapshotBucket)
		if b == nil {
			return nil
		}
		return b.ForEach(func(key, value []byte) error {
			keyCluster, kind, namespace, ok := decodeSnapshotKey(key)
			if !ok || keyCluster != cluster {
				return nil
			}
			cells = append(cells, persistedSnapshotCell{
				Kind:      ResourceKind(kind),
				Namespace: namespace,
				Payload:   append([]byte(nil), value...),
			})
			return nil
		})
	})
	return cells, err
}

func (p *boltSnapshotPersistence) LoadSignalHistory(cluster string) (map[string]signalHistoryRecord, error) {
	if p == nil || p.db == nil {
		return nil, nil
	}
	out := map[string]signalHistoryRecord{}
	prefix := signalHistoryKey(cluster, "")
	err := p.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSignalBucket)
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for key, value := c.Seek(prefix); key != nil && bytes.HasPrefix(key, prefix); key, value = c.Next() {
			signalKey := strings.TrimPrefix(string(key), string(prefix))
			if signalKey == "" {
				continue
			}
			var rec signalHistoryRecord
			if err := json.Unmarshal(value, &rec); err != nil {
				return err
			}
			out[signalKey] = rec
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (p *boltSnapshotPersistence) UpsertSignalHistory(cluster string, updates map[string]signalHistoryRecord) error {
	if p == nil || p.db == nil || len(updates) == 0 {
		return nil
	}
	return p.db.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists(dataplaneSignalBucket)
		if err != nil {
			return err
		}
		for key, rec := range updates {
			payload, err := json.Marshal(rec)
			if err != nil {
				return err
			}
			if err := b.Put(signalHistoryKey(cluster, key), payload); err != nil {
				return err
			}
		}
		return nil
	})
}

func (p *boltSnapshotPersistence) PruneSignalHistoryOlderThan(cluster string, maxAge time.Duration) error {
	if p == nil || p.db == nil || maxAge <= 0 {
		return nil
	}
	cutoff := time.Now().UTC().Add(-maxAge).Unix()
	return p.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSignalBucket)
		if b == nil {
			return nil
		}
		var deleteKeys [][]byte
		if cluster == "" {
			if err := b.ForEach(func(key, value []byte) error {
				var rec signalHistoryRecord
				if err := json.Unmarshal(value, &rec); err != nil {
					return err
				}
				if rec.LastSeenAt > 0 && rec.LastSeenAt < cutoff {
					deleteKeys = append(deleteKeys, append([]byte(nil), key...))
				}
				return nil
			}); err != nil {
				return err
			}
		} else {
			prefix := signalHistoryKey(cluster, "")
			c := b.Cursor()
			for key, value := c.Seek(prefix); key != nil && bytes.HasPrefix(key, prefix); key, value = c.Next() {
				var rec signalHistoryRecord
				if err := json.Unmarshal(value, &rec); err != nil {
					return err
				}
				if rec.LastSeenAt > 0 && rec.LastSeenAt < cutoff {
					deleteKeys = append(deleteKeys, append([]byte(nil), key...))
				}
			}
		}
		for _, key := range deleteKeys {
			if err := b.Delete(key); err != nil {
				return err
			}
		}
		return nil
	})
}

func (p *boltSnapshotPersistence) SearchNamePrefix(prefix string, limit int) ([]dataplaneSearchRow, error) {
	if p == nil || p.db == nil || limit <= 0 {
		return nil, nil
	}
	seek := []byte(strings.ToLower(prefix))
	rows := make([]dataplaneSearchRow, 0, limit)
	err := p.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSearchBucket)
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for key, value := c.Seek(seek); key != nil && bytes.HasPrefix(key, seek) && len(rows) < limit; key, value = c.Next() {
			var row dataplaneSearchRow
			if err := json.Unmarshal(value, &row); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return nil
	})
	return rows, err
}

func (p *boltSnapshotPersistence) SearchName(cluster string, query string, limit int, offset int) ([]dataplaneSearchRow, error) {
	if p == nil || p.db == nil || limit <= 0 {
		return nil, nil
	}
	if offset < 0 {
		offset = 0
	}
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return nil, nil
	}
	rows := make([]dataplaneSearchRow, 0, limit+offset)
	err := p.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(dataplaneSearchBucket)
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for key, value := c.First(); key != nil; key, value = c.Next() {
			var row dataplaneSearchRow
			if err := json.Unmarshal(value, &row); err != nil {
				return err
			}
			if cluster != "" && row.Cluster != cluster {
				continue
			}
			if !strings.Contains(strings.ToLower(row.Name), needle) {
				continue
			}
			rows = append(rows, row)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if pi, pj := searchKindPriority(rows[i].Kind), searchKindPriority(rows[j].Kind); pi != pj {
			return pi < pj
		}
		if ni, nj := strings.ToLower(rows[i].Name), strings.ToLower(rows[j].Name); ni != nj {
			return ni < nj
		}
		if rows[i].Namespace != rows[j].Namespace {
			return rows[i].Namespace < rows[j].Namespace
		}
		if rows[i].Kind != rows[j].Kind {
			return rows[i].Kind < rows[j].Kind
		}
		return rows[i].Cluster < rows[j].Cluster
	})
	if offset >= len(rows) {
		return nil, nil
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[offset:end], nil
}

type dataplaneSearchRow struct {
	Cluster    string `json:"cluster"`
	Kind       string `json:"kind"`
	Namespace  string `json:"namespace,omitempty"`
	Name       string `json:"name"`
	ObservedAt string `json:"observedAt,omitempty"`
}

func searchKindPriority(kind string) int {
	switch ResourceKind(kind) {
	case ResourceKindHelmReleases:
		return 0
	case ResourceKindDeployments:
		return 1
	case ResourceKindReplicaSets, ResourceKindDaemonSets, ResourceKindStatefulSets:
		return 2
	default:
		return 3
	}
}

func deleteCellIndex(search, cells *bolt.Bucket, cellKey []byte) error {
	raw := cells.Get(cellKey)
	if raw == nil {
		return nil
	}
	var keys [][]byte
	if err := json.Unmarshal(raw, &keys); err != nil {
		return err
	}
	for _, key := range keys {
		if err := search.Delete(key); err != nil {
			return err
		}
	}
	return cells.Delete(cellKey)
}

func signalHistoryKey(cluster, key string) []byte {
	return []byte(cluster + searchKeySeparator + key)
}

func searchRowsFromSnapshot(cluster string, kind ResourceKind, namespace string, snap any) []dataplaneSearchRow {
	v := reflect.ValueOf(snap)
	if v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return nil
	}
	items := v.FieldByName("Items")
	if !items.IsValid() || items.Kind() != reflect.Slice {
		return nil
	}
	observedAt := ""
	if meta := v.FieldByName("Meta"); meta.IsValid() && meta.Kind() == reflect.Struct {
		if observed := meta.FieldByName("ObservedAt"); observed.IsValid() && observed.CanInterface() {
			if ts, ok := observed.Interface().(time.Time); ok && !ts.IsZero() {
				observedAt = ts.UTC().Format(time.RFC3339Nano)
			}
		}
	}
	rows := make([]dataplaneSearchRow, 0, items.Len())
	for i := 0; i < items.Len(); i++ {
		item := items.Index(i)
		if item.Kind() == reflect.Pointer {
			if item.IsNil() {
				continue
			}
			item = item.Elem()
		}
		if item.Kind() != reflect.Struct {
			continue
		}
		name := stringField(item, "Name")
		if name == "" {
			continue
		}
		ns := stringField(item, "Namespace")
		if ns == "" {
			ns = namespace
		}
		rows = append(rows, dataplaneSearchRow{
			Cluster:    cluster,
			Kind:       string(kind),
			Namespace:  ns,
			Name:       name,
			ObservedAt: observedAt,
		})
	}
	return rows
}

func persistedSnapshotObservedAt(payload []byte) (time.Time, bool) {
	var envelope struct {
		Meta struct {
			ObservedAt time.Time
		}
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return time.Time{}, false
	}
	if envelope.Meta.ObservedAt.IsZero() {
		return time.Time{}, false
	}
	return envelope.Meta.ObservedAt.UTC(), true
}

func stringField(v reflect.Value, name string) string {
	f := v.FieldByName(name)
	if !f.IsValid() || f.Kind() != reflect.String {
		return ""
	}
	return f.String()
}

func snapshotKey(cluster string, kind ResourceKind, namespace string) []byte {
	return []byte(strings.Join([]string{keyPart(cluster), keyPart(string(kind)), keyPart(namespace)}, "/"))
}

func decodeSnapshotKey(key []byte) (cluster string, kind string, namespace string, ok bool) {
	parts := strings.Split(string(key), "/")
	if len(parts) != 3 {
		return "", "", "", false
	}
	cluster, err := decodeKeyPart(parts[0])
	if err != nil {
		return "", "", "", false
	}
	kind, err = decodeKeyPart(parts[1])
	if err != nil {
		return "", "", "", false
	}
	namespace, err = decodeKeyPart(parts[2])
	if err != nil {
		return "", "", "", false
	}
	return cluster, kind, namespace, true
}

func searchIndexKey(row dataplaneSearchRow) []byte {
	normalized := strings.ToLower(row.Name)
	return []byte(strings.Join([]string{
		normalized,
		keyPart(row.Cluster),
		keyPart(row.Kind),
		keyPart(row.Namespace),
		keyPart(row.Name),
	}, searchKeySeparator))
}

func keyPart(s string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(s))
}

func decodeKeyPart(s string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func markPersistedSnapshot[I any](snap *Snapshot[I], maxAge time.Duration) bool {
	if snap == nil || snap.Meta.ObservedAt.IsZero() {
		return false
	}
	if maxAge > 0 && time.Since(snap.Meta.ObservedAt) > maxAge {
		return false
	}
	snap.Meta.Freshness = FreshnessClassStale
	if snap.Meta.Degradation == "" || snap.Meta.Degradation == DegradationClassNone {
		snap.Meta.Degradation = DegradationClassMinor
	}
	if snap.Meta.Coverage == "" {
		snap.Meta.Coverage = CoverageClassUnknown
	}
	if snap.Meta.Completeness == "" {
		snap.Meta.Completeness = CompletenessClassUnknown
	}
	return true
}

func persistedSnapshotFallback[I any](persisted Snapshot[I], live Snapshot[I]) Snapshot[I] {
	if live.Err != nil {
		persisted.Err = live.Err
	}
	if persisted.Err == nil {
		n := NormalizeError(errors.New("live refresh failed; using persisted dataplane snapshot"))
		persisted.Err = &n
	}
	persisted.Meta.Freshness = FreshnessClassStale
	persisted.Meta.Degradation = WorstDegradation(persisted.Meta.Degradation, DegradationClassMinor)
	return persisted
}

func persistenceOpenError(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("open dataplane persistence: %w", err)
}
