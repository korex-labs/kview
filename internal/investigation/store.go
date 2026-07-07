package investigation

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNotFound = errors.New("investigation snapshot not found")

type TriageState string

const (
	TriageWatching      TriageState = "watching"
	TriageInvestigating TriageState = "investigating"
	TriageKnown         TriageState = "known"
	TriageResolved      TriageState = "resolved"
	TriageIgnored       TriageState = "ignored"
)

type SignalRef struct {
	Type       string `json:"type"`
	Title      string `json:"title,omitempty"`
	Severity   string `json:"severity,omitempty"`
	Category   string `json:"category,omitempty"`
	ObservedAt int64  `json:"observedAt,omitempty"`
}

type ResourceRef struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	UID       string `json:"uid,omitempty"`
}

type Snapshot struct {
	ID                 string        `json:"id"`
	Context            string        `json:"context"`
	CreatedAt          int64         `json:"createdAt"`
	UpdatedAt          int64         `json:"updatedAt"`
	Title              string        `json:"title"`
	TriageState        TriageState   `json:"triageState"`
	Signal             SignalRef     `json:"signal"`
	PrimaryResource    ResourceRef   `json:"primaryResource"`
	RelatedResources   []ResourceRef `json:"relatedResources,omitempty"`
	RelatedSignalTypes []string      `json:"relatedSignalTypes,omitempty"`
	Markdown           string        `json:"markdown"`
	OperatorNote       string        `json:"operatorNote,omitempty"`
	RunbookURLs        []string      `json:"runbookUrls,omitempty"`
	Source             string        `json:"source"`
}

type ListFilter struct {
	Context   string
	Kind      string
	Namespace string
	Name      string
}

type Store interface {
	Save(snapshot Snapshot) (Snapshot, error)
	List(filter ListFilter) ([]Snapshot, error)
	Get(id string) (Snapshot, bool, error)
	Delete(id string) error
}

type fileStoreData struct {
	V       int                 `json:"v"`
	Records map[string]Snapshot `json:"records"`
}

type FileStore struct {
	mu   sync.Mutex
	path string
}

func DefaultStorePath() string {
	base, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(base) == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "kview", "investigation-snapshots.json")
}

func NewFileStore(path string) *FileStore {
	if strings.TrimSpace(path) == "" {
		path = DefaultStorePath()
	}
	return &FileStore{path: path}
}

func (s *FileStore) Save(snapshot Snapshot) (Snapshot, error) {
	if s == nil {
		return Snapshot{}, errors.New("nil investigation store")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return Snapshot{}, err
	}
	cleaned := normalizeSnapshot(snapshot, time.Now().UTC().UnixMilli())
	if err := validateSnapshot(cleaned); err != nil {
		return Snapshot{}, err
	}
	if existing, ok := data.Records[cleaned.ID]; ok && cleaned.CreatedAt == 0 {
		cleaned.CreatedAt = existing.CreatedAt
	}
	if existing, ok := data.Records[cleaned.ID]; ok && existing.CreatedAt > 0 {
		cleaned.CreatedAt = existing.CreatedAt
	}
	data.Records[cleaned.ID] = cleaned
	if err := s.saveLocked(data); err != nil {
		return Snapshot{}, err
	}
	return cleaned, nil
}

func (s *FileStore) List(filter ListFilter) ([]Snapshot, error) {
	if s == nil {
		return nil, errors.New("nil investigation store")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	out := make([]Snapshot, 0, len(data.Records))
	for _, snapshot := range data.Records {
		if !matchesFilter(snapshot, filter) {
			continue
		}
		out = append(out, snapshot)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return out[i].CreatedAt > out[j].CreatedAt
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (s *FileStore) Get(id string) (Snapshot, bool, error) {
	if s == nil {
		return Snapshot{}, false, errors.New("nil investigation store")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return Snapshot{}, false, err
	}
	snapshot, ok := data.Records[cleanSingleLine(id, 128)]
	return snapshot, ok, nil
}

func (s *FileStore) Delete(id string) error {
	if s == nil {
		return errors.New("nil investigation store")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	id = cleanSingleLine(id, 128)
	if _, ok := data.Records[id]; !ok {
		return ErrNotFound
	}
	delete(data.Records, id)
	return s.saveLocked(data)
}

func (s *FileStore) loadLocked() (fileStoreData, error) {
	data := fileStoreData{V: 1, Records: map[string]Snapshot{}}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return data, nil
		}
		return data, err
	}
	if len(raw) == 0 {
		return data, nil
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return fileStoreData{}, err
	}
	if data.Records == nil {
		data.Records = map[string]Snapshot{}
	}
	cleaned := fileStoreData{V: 1, Records: map[string]Snapshot{}}
	for _, snapshot := range data.Records {
		normalized := normalizeSnapshot(snapshot, snapshot.UpdatedAt)
		if validateSnapshot(normalized) == nil {
			cleaned.Records[normalized.ID] = normalized
		}
	}
	return cleaned, nil
}

func (s *FileStore) saveLocked(data fileStoreData) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, append(payload, '\n'), 0o600)
}

func normalizeSnapshot(snapshot Snapshot, now int64) Snapshot {
	if now <= 0 {
		now = time.Now().UTC().UnixMilli()
	}
	snapshot.ID = cleanSingleLine(snapshot.ID, 128)
	if snapshot.ID == "" {
		snapshot.ID = newID()
	}
	snapshot.Context = cleanSingleLine(snapshot.Context, 128)
	snapshot.Title = cleanSingleLine(snapshot.Title, 240)
	snapshot.TriageState = normalizeTriageState(snapshot.TriageState)
	snapshot.Signal = SignalRef{
		Type:       cleanSingleLine(snapshot.Signal.Type, 128),
		Title:      cleanSingleLine(snapshot.Signal.Title, 240),
		Severity:   cleanSingleLine(snapshot.Signal.Severity, 32),
		Category:   cleanSingleLine(snapshot.Signal.Category, 64),
		ObservedAt: positiveTimestamp(snapshot.Signal.ObservedAt),
	}
	snapshot.PrimaryResource = normalizeResourceRef(snapshot.PrimaryResource)
	snapshot.RelatedResources = normalizeResourceRefs(snapshot.RelatedResources, 64)
	snapshot.RelatedSignalTypes = normalizeStringList(snapshot.RelatedSignalTypes, 64, 128)
	snapshot.Markdown = cleanText(snapshot.Markdown, 200000)
	snapshot.OperatorNote = cleanText(snapshot.OperatorNote, 8000)
	snapshot.RunbookURLs = normalizeStringList(snapshot.RunbookURLs, 16, 2048)
	snapshot.Source = cleanSingleLine(snapshot.Source, 64)
	if snapshot.Source == "" {
		snapshot.Source = "investigate-signal"
	}
	if snapshot.CreatedAt <= 0 {
		snapshot.CreatedAt = now
	}
	if snapshot.UpdatedAt <= 0 || snapshot.UpdatedAt < snapshot.CreatedAt {
		snapshot.UpdatedAt = now
	}
	return snapshot
}

func validateSnapshot(snapshot Snapshot) error {
	if snapshot.Context == "" {
		return errors.New("context is required")
	}
	if snapshot.Title == "" {
		return errors.New("title is required")
	}
	if snapshot.Signal.Type == "" {
		return errors.New("signal type is required")
	}
	if snapshot.PrimaryResource.Kind == "" || snapshot.PrimaryResource.Name == "" {
		return errors.New("primary resource kind and name are required")
	}
	if snapshot.Markdown == "" {
		return errors.New("markdown is required")
	}
	return nil
}

func matchesFilter(snapshot Snapshot, filter ListFilter) bool {
	if filter.Context != "" && snapshot.Context != cleanSingleLine(filter.Context, 128) {
		return false
	}
	if filter.Kind != "" && !strings.EqualFold(snapshot.PrimaryResource.Kind, cleanSingleLine(filter.Kind, 128)) {
		return false
	}
	if filter.Namespace != "" && snapshot.PrimaryResource.Namespace != cleanSingleLine(filter.Namespace, 128) {
		return false
	}
	if filter.Name != "" && snapshot.PrimaryResource.Name != cleanSingleLine(filter.Name, 256) {
		return false
	}
	return true
}

func normalizeTriageState(value TriageState) TriageState {
	switch value {
	case TriageWatching, TriageInvestigating, TriageKnown, TriageResolved, TriageIgnored:
		return value
	default:
		return TriageInvestigating
	}
}

func normalizeResourceRef(ref ResourceRef) ResourceRef {
	return ResourceRef{
		Kind:      cleanSingleLine(ref.Kind, 128),
		Namespace: cleanSingleLine(ref.Namespace, 128),
		Name:      cleanSingleLine(ref.Name, 256),
		UID:       cleanSingleLine(ref.UID, 256),
	}
}

func normalizeResourceRefs(values []ResourceRef, maxItems int) []ResourceRef {
	out := make([]ResourceRef, 0, len(values))
	for _, value := range values {
		ref := normalizeResourceRef(value)
		if ref.Kind == "" || ref.Name == "" {
			continue
		}
		out = append(out, ref)
		if len(out) >= maxItems {
			break
		}
	}
	return out
}

func normalizeStringList(values []string, maxItems int, maxLength int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		cleaned := cleanSingleLine(value, maxLength)
		if cleaned == "" || seen[cleaned] {
			continue
		}
		seen[cleaned] = true
		out = append(out, cleaned)
		if len(out) >= maxItems {
			break
		}
	}
	return out
}

func cleanText(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	if len(value) > maxLength {
		value = value[:maxLength]
	}
	return value
}

func cleanSingleLine(value string, maxLength int) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(value) > maxLength {
		value = value[:maxLength]
	}
	return value
}

func positiveTimestamp(value int64) int64 {
	if value > 0 {
		return value
	}
	return 0
}

func newID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(buf[:])
}
