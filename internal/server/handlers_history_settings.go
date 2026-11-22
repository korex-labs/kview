package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/korex-labs/kview/v5/internal/localhistory"
)

// historyStartFailure stores only enumerated classifications, never arbitrary errors.
type historyStartFailure string

const (
	historyContextUnavailable   historyStartFailure = "history_context_unavailable"
	historySourceUnavailable    historyStartFailure = "history_source_unavailable"
	historyStorageUnavailable   historyStartFailure = "history_storage_unavailable"
	historyDatabaseIncompatible historyStartFailure = "history_database_incompatible"
	historySettingsUnavailable  historyStartFailure = "history_settings_unavailable"
)

func (f historyStartFailure) Error() string { return f.message() }

func classifyHistoryStartFailure(err error) historyStartFailure {
	if errors.Is(err, localhistory.ErrIncompatibleDatabase) {
		return historyDatabaseIncompatible
	}
	if errors.Is(err, localhistory.ErrHistorySourceUnavailable) {
		return historySourceUnavailable
	}
	return historyStorageUnavailable
}
func (f historyStartFailure) message() string {
	switch f {
	case "":
		return ""
	case historyContextUnavailable:
		return "Saved context is no longer available."
	case historySourceUnavailable:
		return "Cache-only history source unavailable. Check server dataplane availability, then retry History settings."
	case historySettingsUnavailable:
		return "History is disabled because its settings could not be loaded or initialized. The existing file has been preserved and settings changes are blocked. Check permissions and format of kview/local-history/settings.json in your user configuration directory. To explicitly reset History consent, stop kview, move that file aside as a backup, then restart and opt in again in History settings."
	case historyDatabaseIncompatible:
		return "The existing history database is incompatible and has been preserved. To explicitly start fresh, stop kview, move the old history database file aside, then restart and save History settings to retry. No automatic migration or deletion is performed."
	default:
		return "Saved settings could not start collection. Check server storage, then save again to retry."
	}
}

// historySettingsMutation excludes server-owned identity and retired scope controls.
// Optional policy fields preserve sparse intent; revisions and scope are mandatory.
type historySettingsMutation struct {
	Enabled        *bool   `json:"enabled"`
	SignalHistory  *bool   `json:"signalHistory"`
	RetentionDays  *int    `json:"retentionDays"`
	Revision       *uint64 `json:"revision"`
	Scope          string  `json:"scope"`
	GlobalRevision *uint64 `json:"globalRevision"`
	Reset          bool    `json:"reset"`
}

// InitializeLocalHistory restores saved consent. Failure disables only History;
// callers must keep the application running. Returned errors are safe to log.
func (s *Server) InitializeLocalHistory(ctx context.Context) error {
	dir, err := localhistory.SettingsDirectory()
	if err != nil {
		s.historyMu.Lock()
		s.historyInitFailure = historySettingsUnavailable
		s.historyMu.Unlock()
		return historySettingsUnavailable
	}
	return s.initializeHistorySettings(ctx, dir)
}
func (s *Server) initializeHistorySettings(ctx context.Context, dir string) (err error) {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	// Never replace unreadable consent with defaults or expose decoder/path errors.
	defer func() {
		if err != nil {
			s.historyInitFailure = historySettingsUnavailable
			err = historySettingsUnavailable
		}
	}()
	settings, err := localhistory.LoadSettings(dir)
	if err != nil {
		return err
	}
	s.historyDirectory = dir
	s.historyParent = ctx
	// Materialize independent identities before starting any inherited collector.
	changed, err := s.ensureHistoryIdentities(settings)
	if err != nil {
		return err
	}
	if changed {
		if err := localhistory.SaveSettings(dir, settings); err != nil {
			return err
		}
	}
	s.historySettings = settings
	s.historyInitFailure = ""
	policies := map[string]localhistory.Policy{}
	for name := range settings.Contexts {
		policies[name] = settings.Effective(name)
	}
	s.historyCollectors = map[string]*localhistory.Collector{}
	s.historyFailures = map[string]historyStartFailure{}
	for name, p := range policies {
		if p.Enabled {
			_ = s.startHistoryPolicy(name, p)
		}
	}
	return nil
}

// All callers hold historyMu exclusively. Collector Close cancels and joins
// before a DB can be reopened; read handlers hold its read lock through Query.
func (s *Server) startHistoryPolicy(name string, p localhistory.Policy) error {
	if !p.Enabled || !p.SignalHistory {
		return nil
	}
	if s.mgr == nil {
		s.historyFailures[name] = historyContextUnavailable
		return errors.New("history context unavailable")
	}
	if _, ok := s.mgr.ContextInfo(name); !ok {
		s.historyFailures[name] = historyContextUnavailable
		return errors.New("history context unavailable")
	}
	source, ok := s.dp.(localhistory.PublicationTrendSource)
	if !ok {
		s.historyFailures[name] = historySourceUnavailable
		return errors.New("history source unavailable")
	}
	sum := sha256.Sum256([]byte(name))
	c := localhistory.Config{Binding: strconv.FormatUint(s.historySettings.Contexts[name].Binding, 10), SignalHistory: p.SignalHistory, SignalEpoch: p.SignalEpoch, Enabled: true, Directory: filepath.Join(s.historyDirectory, hex.EncodeToString(sum[:])), RetentionDays: p.RetentionDays, QueryContext: name}
	h, err := localhistory.StartManaged(s.historyParent, c, source)
	if err != nil {
		s.historyFailures[name] = classifyHistoryStartFailure(err)
		return err
	}
	s.historyCollectors[name] = h
	delete(s.historyFailures, name)
	return nil
}
func (s *Server) historyForContext(name string) *localhistory.Collector {
	return s.historyCollectors[name]
}
func (s *Server) historyFailure(name string) historyStartFailure {
	if s.historyInitFailure != "" {
		return s.historyInitFailure
	}
	return s.historyFailures[name]
}
func (s *Server) historyPolicy(name string) localhistory.Policy {
	if s.historySettings != nil {
		return s.historySettings.Effective(name)
	}
	return localhistory.Policy{RetentionDays: 30}
}
func (s *Server) historySettingsIdentity(w http.ResponseWriter, r *http.Request) (string, bool) {
	name := r.Header.Get("X-Kview-Context")
	if len(r.Header.Values("X-Kview-Context")) != 1 || localhistory.ValidateScope(localhistory.Scope{Context: name}) != nil || r.URL.RawQuery != "" {
		writeErrorResponse(w, 400, "one explicit context and no query parameters required")
		return "", false
	}
	if s.mgr == nil {
		writeErrorResponse(w, 503, "context registry unavailable")
		return "", false
	}
	if _, ok := s.mgr.ContextInfo(name); !ok {
		writeErrorResponse(w, 404, "unknown history context")
		return "", false
	}
	return name, true
}

// This typed response carries only enumerated safe errors, including on failed POST.
// Do not put arbitrary storage errors into this public DTO.
type historyContextFailureDTO struct {
	Context   string              `json:"context"`
	Error     string              `json:"error"`
	ErrorCode historyStartFailure `json:"errorCode"`
}
type historySettingsDTO struct {
	CollectionFailures      []historyContextFailureDTO   `json:"collectionFailures"`
	SignalHistoryCapability map[string]any               `json:"signalHistoryCapability"`
	Context                 string                       `json:"context"`
	Global                  localhistory.Defaults        `json:"global"`
	GlobalRevision          uint64                       `json:"globalRevision"`
	Override                localhistory.PolicyOverride  `json:"override"`
	Policy                  localhistory.Policy          `json:"policy"`
	Editable                bool                         `json:"editable"`
	Collector               localhistory.CollectorStatus `json:"collector"`
	Error                   string                       `json:"error"`
	ErrorCode               historyStartFailure          `json:"errorCode"`
}

func (s *Server) historySettingsResponse(name string) historySettingsDTO {
	settings := s.historySettings
	if settings == nil {
		settings = localhistory.DefaultSettings()
	}
	failures := []historyContextFailureDTO{}
	for context, failure := range s.historyFailures {
		if failure != "" {
			failures = append(failures, historyContextFailureDTO{Context: context, Error: failure.message(), ErrorCode: failure})
		}
	}
	sort.Slice(failures, func(i, j int) bool { return failures[i].Context < failures[j].Context })
	return historySettingsDTO{
		CollectionFailures: failures,
		Global:             settings.Global, GlobalRevision: settings.Revision, Override: settings.ContextOverrides[name],
		SignalHistoryCapability: map[string]any{"available": true, "requiresIdentityConsent": true, "epochRequired": false, "partial": true},
		Context:                 name, Policy: s.historyPolicy(name), Editable: !s.readOnly && !s.historyClosed && s.historyDirectory != "" && s.historySettings != nil && s.historyInitFailure == "",
		Collector: s.historyForContext(name).Status(), Error: s.historyFailure(name).message(), ErrorCode: s.historyFailure(name),
	}
}
func (s *Server) getHistorySettings(w http.ResponseWriter, r *http.Request) {
	name, ok := s.historySettingsIdentity(w, r)
	if !ok {
		return
	}
	if r.Body != nil {
		var b [1]byte
		if n, e := r.Body.Read(b[:]); n != 0 || e != io.EOF {
			writeErrorResponse(w, 400, "GET body not supported")
			return
		}
	}
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()
	writeJSON(w, 200, s.historySettingsResponse(name))
}
func (s *Server) saveHistorySettings(w http.ResponseWriter, r *http.Request) {
	// No cookies/query-token authority for consent. A JSON bearer request requires
	// browser preflight; cross-site form posts and ambient credentials cannot opt in.
	if s.token == "" || r.Header.Get("Authorization") != "Bearer "+s.token {
		writeErrorResponse(w, 401, "explicit bearer authentication required")
		return
	}
	if s.readOnly {
		writeErrorResponse(w, 403, "read-only mode blocks history settings changes")
		return
	}
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		writeErrorResponse(w, 403, "cross-site history changes are not allowed")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		writeErrorResponse(w, 415, "application/json required")
		return
	}
	name, ok := s.historySettingsIdentity(w, r)
	if !ok {
		return
	}
	var input *historySettingsMutation
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
	dec.DisallowUnknownFields()
	if dec.Decode(&input) != nil || input == nil || input.Revision == nil || input.GlobalRevision == nil || (input.Scope != "global" && input.Scope != "context") || (input.Reset && input.Scope != "context") {
		writeErrorResponse(w, 400, "invalid history settings")
		return
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		writeErrorResponse(w, 400, "one settings object required")
		return
	}
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	if s.historyInitFailure != "" {
		writeJSON(w, 503, s.historySettingsResponse(name))
		return
	}
	if s.historyClosed || s.historyDirectory == "" || s.historySettings == nil {
		writeErrorResponse(w, 503, "history settings unavailable")
		return
	}
	old := s.historySettings
	expected := s.historyPolicy(name).Revision
	if input.Scope == "global" {
		expected = old.Revision
	}
	if *input.Revision != expected || (input.GlobalRevision != nil && *input.GlobalRevision != old.Revision) {
		writeErrorResponse(w, 409, "history settings changed; review server state before retrying")
		return
	}
	next := old.Clone()
	if input.Scope == "global" {
		if input.Enabled != nil {
			next.Global.Enabled = *input.Enabled
		}
		if input.SignalHistory != nil {
			next.Global.SignalHistory = *input.SignalHistory
		}
		if input.RetentionDays != nil {
			next.Global.RetentionDays = *input.RetentionDays
		}
		next.Revision++
	} else {
		o := next.ContextOverrides[name]
		if input.Reset {
			o = localhistory.PolicyOverride{}
		}
		{
			if input.Enabled != nil {
				o.Enabled = input.Enabled
				if *o.Enabled == next.Global.Enabled {
					o.Enabled = nil
				}
			}
			if input.SignalHistory != nil {
				o.SignalHistory = input.SignalHistory
				if *o.SignalHistory == next.Global.SignalHistory {
					o.SignalHistory = nil
				}
			}
			if input.RetentionDays != nil {
				o.RetentionDays = input.RetentionDays
				if *o.RetentionDays == next.Global.RetentionDays {
					o.RetentionDays = nil
				}
			}
		}
		if o.Enabled == nil && o.SignalHistory == nil && o.RetentionDays == nil {
			delete(next.ContextOverrides, name)
		} else {
			next.ContextOverrides[name] = o
		}
		c := next.Contexts[name]
		c.Revision++
		next.Contexts[name] = c
	}
	if _, err = s.ensureHistoryIdentities(next); err != nil {
		writeErrorResponse(w, 503, "signal history identity could not be initialized; existing settings unchanged")
		return
	}
	// Rotate only the exact contexts whose effective collection binding changes.
	for name, identity := range next.Contexts {
		before, after := old.Effective(name), next.Effective(name)
		if before.Enabled != after.Enabled || before.SignalHistory != after.SignalHistory || before.RetentionDays != after.RetentionDays {
			identity.Binding++
			next.Contexts[name] = identity
		}
	}
	if err = next.Validate(); err != nil {
		writeErrorResponse(w, 400, err.Error())
		return
	}
	if err = localhistory.SaveSettings(s.historyDirectory, next); err != nil {
		writeErrorResponse(w, 503, "history settings could not be saved; existing settings unchanged")
		return
	}
	s.historySettings = next
	failed := false
	for c := range next.Contexts {
		p := next.Effective(c)
		before := old.Effective(c)
		// Revision-only saves and unrelated global edits do not restart workers.
		if before.Enabled == p.Enabled && before.SignalHistory == p.SignalHistory && before.RetentionDays == p.RetentionDays && before.SignalEpoch == p.SignalEpoch && s.historyFailures[c] == "" {
			continue
		}
		s.historyCollectors[c].Close()
		delete(s.historyCollectors, c)
		delete(s.historyFailures, c)
		if s.startHistoryPolicy(c, p) != nil {
			failed = true
		}
	}
	if failed {
		writeJSON(w, 503, s.historySettingsResponse(name))
		return
	}
	writeJSON(w, 200, s.historySettingsResponse(name))
}

// A global opt-in covers registered contexts, including contexts added on restart.
// Epochs never come from global defaults or another context, and precede collection.
func (s *Server) ensureHistoryIdentities(settings *localhistory.Settings) (bool, error) {
	names := map[string]bool{}
	for name := range settings.Contexts {
		names[name] = true
	}
	if s.mgr != nil {
		for _, c := range s.mgr.ListContexts() {
			names[c.Name] = true
		}
	}
	changed := false
	for name := range names {
		p := settings.Effective(name)
		if !p.SignalHistory || p.SignalEpoch != "" {
			continue
		}
		var generation [16]byte
		if _, err := rand.Read(generation[:]); err != nil {
			return false, err
		}
		c := settings.Contexts[name]
		c.SignalEpoch = hex.EncodeToString(generation[:])
		settings.Contexts[name] = c
		changed = true
	}
	return changed, nil
}
