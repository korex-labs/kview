package localhistory

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Policy is backend-owned consent for one exact kubeconfig context. No paths or
// context supplied in a mutation body can redirect collection.
type Policy struct {
	SignalHistory bool   `json:"signalHistory"`
	SignalEpoch   string `json:"signalEpoch,omitempty"`
	Enabled       bool   `json:"enabled"`
	RetentionDays int    `json:"retentionDays"`
	Revision      uint64 `json:"revision"`
}

func (p Policy) Validate(context string) error {
	if p.SignalHistory && (p.SignalEpoch == "" || len(p.SignalEpoch) > 128 || !validIdentity(p.SignalEpoch, false)) {
		return errors.New("signal history policy requires a valid internal identity generation")
	}
	if p.RetentionDays != 30 && p.RetentionDays != 90 {
		return errors.New("retention must be 30 or 90 days")
	}
	return ValidateScope(Scope{Context: context})
}
func SettingsDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil || !filepath.IsAbs(base) {
		return "", errors.New("history settings directory unavailable")
	}
	return filepath.Join(base, "kview", "local-history"), nil
}
func privateDirectory(dir string) error {
	if !filepath.IsAbs(dir) {
		return errors.New("history directory must be absolute")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("history directory must be private and not a symlink")
	}
	return nil
}
func LoadSettings(dir string) (*Settings, error) {
	if !filepath.IsAbs(dir) {
		return nil, errors.New("history directory must be absolute")
	}
	out := DefaultSettings()
	path := filepath.Join(dir, "settings.json")
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	// Reject unsafe state rather than silently resetting previously saved consent.
	parent, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if !parent.IsDir() || parent.Mode().Perm()&0077 != 0 || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 65536 {
		return nil, errors.New("invalid history settings file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	// Read-only handle: cleanup is best-effort; decoding/validation errors take precedence.
	defer func() { _ = f.Close() }()
	dec := json.NewDecoder(io.LimitReader(f, 65537))
	dec.DisallowUnknownFields()
	out = nil
	if err = dec.Decode(&out); err != nil {
		return nil, err
	}
	var extra any
	if dec.Decode(&extra) != io.EOF || out == nil {
		return nil, errors.New("invalid history settings")
	}
	if err = out.Validate(); err != nil {
		return nil, err
	}
	return out, nil
}
func validatePolicies(policies map[string]Policy) error {
	if policies == nil {
		return errors.New("history settings must be an object")
	}
	if len(policies) > MaxScopes {
		return errors.New("history context limit reached")
	}
	for c, p := range policies {
		if err := p.Validate(c); err != nil {
			return err
		}
	}
	return nil
}

// SaveSettings uses the same private temp + fsync + atomic rename pattern as
// installation-statistics, never a partially written JSON file.
func SaveSettings(dir string, policies *Settings) error {
	if err := policies.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(policies)
	if err != nil {
		return err
	}
	if len(raw) > 65536 {
		return errors.New("history settings size limit reached")
	}
	if err = privateDirectory(dir); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".settings-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(f.Name()) }()
	if _, err = f.Write(raw); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), filepath.Join(dir, "settings.json"))
}
