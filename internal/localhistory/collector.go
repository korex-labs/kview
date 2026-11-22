package localhistory

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Scope identifies a context/namespace for query and publication validation.
type Scope struct {
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
}
type Config struct {
	SignalHistory bool   `json:"signalHistory"`
	SignalEpoch   string `json:"signalEpoch,omitempty"`
	Enabled       bool   `json:"enabled"`
	Directory     string `json:"directory"`
	RetentionDays int    `json:"retentionDays"`
	// Server-owned managed context; never accepted from startup JSON.
	QueryContext string `json:"-"`
	// A nonempty binding is issued by the settings owner and survives process restart.
	Binding string `json:"-"`
}

const AdapterVersion = "dashboard-publications-v1"
const MaxScopes = 128
const MaxDatabaseBytes int64 = 512 << 20

func (c Config) Validate() error {
	if c.SignalHistory && (c.QueryContext == "" || c.SignalEpoch == "" || len(c.SignalEpoch) > 128 || !validIdentity(c.SignalEpoch, false)) {
		return errors.New("signal history requires managed exact-context consent and signalEpoch")
	}
	if !c.Enabled {
		return nil
	}
	if !filepath.IsAbs(c.Directory) || (c.RetentionDays != 30 && c.RetentionDays != 90) {
		return errors.New("history requires absolute directory and retentionDays 30/90")
	}
	if !validIdentity(c.QueryContext, false) {
		return errors.New("history requires exact managed context")
	}
	return nil
}

type CollectorStatus struct {
	Publications    *PublicationQueueStatus `json:"publications,omitempty"`
	SkippedCapacity int                     `json:"skippedCapacity"`
	Enabled         bool                    `json:"enabled"`
	AdapterVersion  string                  `json:"adapterVersion"`
	RetentionDays   int                     `json:"retentionDays"`
	SampleSeconds   int                     `json:"sampleSeconds"`
	LastAttempt     time.Time               `json:"lastAttempt"`
	LastSuccess     time.Time               `json:"lastSuccess"`
	LastError       string                  `json:"lastError,omitempty"`
	SkippedUnloaded int                     `json:"skippedUnloaded"`
}
type Collector struct {
	publicationSession string
	publicationQueue   *PublicationQueue
	publicationRelease func()
	store              *Store
	config             Config
	source             PublicationTrendSource
	cancel             context.CancelFunc
	done               chan struct{}
	once               sync.Once
	mu                 sync.RWMutex
	status             CollectorStatus
}

// Start owns a dedicated DB and one worker. Disabled means no filesystem or goroutine.
func Start(parent context.Context, c Config, source PublicationTrendSource) (*Collector, error) {
	return start(parent, c, source, false)
}

// StartManaged permits an intentional UI retention change on the same real DB.
func StartManaged(parent context.Context, c Config, source PublicationTrendSource) (*Collector, error) {
	return start(parent, c, source, true)
}
func start(parent context.Context, c Config, source PublicationTrendSource, managed bool) (*Collector, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	if !c.Enabled || !c.SignalHistory {
		return nil, nil
	}
	if source == nil {
		return nil, ErrHistorySourceUnavailable
	}
	if err := os.MkdirAll(c.Directory, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(c.Directory)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("history directory must be private (0700), not a symlink")
	}
	path := filepath.Join(c.Directory, "history-real-v1.db")
	store, err := openReal(path, c.RetentionDays, managed)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(parent)
	v := &Collector{store: store, config: c, source: source, cancel: cancel, done: make(chan struct{}), status: CollectorStatus{Enabled: true, AdapterVersion: AdapterVersion, RetentionDays: c.RetentionDays, SampleSeconds: SampleSeconds}}
	if err := v.bindPublications(); err != nil {
		cancel()
		_ = store.Close()
		return nil, err
	}
	go func() {
		defer close(v.done)
		defer func() { v.mu.Lock(); v.status.Enabled = false; v.mu.Unlock() }()
		defer v.publicationRelease()
		v.runPublications(ctx)
	}()
	return v, nil
}
func (v *Collector) record(at time.Time, skipped int, err error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.status.LastAttempt = at
	v.status.SkippedUnloaded = skipped
	v.status.LastError = ""
	if err != nil {
		v.status.LastError = "Local history write failed; stored data is preserved. Check server storage."
	} else {
		v.status.LastSuccess = at
	}
}
func (v *Collector) Status() CollectorStatus {
	if v == nil {
		return CollectorStatus{AdapterVersion: AdapterVersion, SampleSeconds: SampleSeconds}
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	status := v.status
	if v.publicationQueue != nil {
		s := v.publicationQueue.Status()
		status.Publications = &s
	}
	return status
}
func (v *Collector) Close() {
	if v == nil {
		return
	}
	v.once.Do(func() {
		// Unsubscribe first, then cancel and join, with no manager/store/status lock.
		if v.publicationRelease != nil {
			v.publicationRelease()
		}
		v.cancel()
		<-v.done
		_ = v.store.Close()
	})
}
