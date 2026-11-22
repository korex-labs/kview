package localhistory

import "errors"

// Defaults are consent and retention only. Identity is always exact-context.
type Defaults struct {
	Enabled       bool `json:"enabled"`
	SignalHistory bool `json:"signalHistory"`
	RetentionDays int  `json:"retentionDays"`
}
type PolicyOverride struct {
	Enabled       *bool `json:"enabled,omitempty"`
	SignalHistory *bool `json:"signalHistory,omitempty"`
	RetentionDays *int  `json:"retentionDays,omitempty"`
}
type ContextIdentity struct {
	Binding     uint64 `json:"binding,omitempty"`
	SignalEpoch string `json:"signalEpoch,omitempty"`
	Revision    uint64 `json:"revision"`
}
type Settings struct {
	Global           Defaults                   `json:"global"`
	Revision         uint64                     `json:"revision"`
	ContextOverrides map[string]PolicyOverride  `json:"contextOverrides"`
	Contexts         map[string]ContextIdentity `json:"contexts"`
}

func DefaultSettings() *Settings {
	return &Settings{Global: Defaults{RetentionDays: 30}, ContextOverrides: map[string]PolicyOverride{}, Contexts: map[string]ContextIdentity{}}
}
func (s *Settings) Effective(name string) Policy {
	d := s.Global
	o := s.ContextOverrides[name]
	if o.Enabled != nil {
		d.Enabled = *o.Enabled
	}
	if o.SignalHistory != nil {
		d.SignalHistory = *o.SignalHistory
	}
	if o.RetentionDays != nil {
		d.RetentionDays = *o.RetentionDays
	}
	c := s.Contexts[name]
	return Policy{Enabled: d.Enabled, SignalHistory: d.SignalHistory, RetentionDays: d.RetentionDays, SignalEpoch: c.SignalEpoch, Revision: c.Revision}
}
func (s *Settings) Clone() *Settings {
	n := *s
	n.ContextOverrides = make(map[string]PolicyOverride, len(s.ContextOverrides))
	for k, v := range s.ContextOverrides {
		n.ContextOverrides[k] = v
	}
	n.Contexts = make(map[string]ContextIdentity, len(s.Contexts))
	for k, v := range s.Contexts {
		n.Contexts[k] = v
	}
	return &n
}
func (s *Settings) Validate() error {
	if s == nil || s.Contexts == nil || s.ContextOverrides == nil {
		return errors.New("invalid history settings")
	}
	if s.Global.RetentionDays != 30 && s.Global.RetentionDays != 90 {
		return errors.New("retention must be 30 or 90 days")
	}
	if len(s.Contexts) > MaxScopes || len(s.ContextOverrides) > MaxScopes {
		return errors.New("history context limit reached")
	}
	for name := range s.ContextOverrides {
		if _, ok := s.Contexts[name]; !ok {
			return errors.New("history override requires context identity record")
		}
	}
	for name, c := range s.Contexts {
		if err := s.Effective(name).Validate(name); err != nil {
			return err
		}
		if c.SignalEpoch != "" && (len(c.SignalEpoch) > 128 || !validIdentity(c.SignalEpoch, false)) {
			return errors.New("invalid history identity")
		}
	}
	return nil
}
