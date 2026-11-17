package localhistory

// These helpers construct/read explicit context policies for internal fixtures.
// The on-disk contract is always Settings; old prototype files are not parsed.
func SavePolicies(dir string, policies map[string]Policy) error {
	if err := validatePolicies(policies); err != nil {
		return err
	}
	s := DefaultSettings()
	for name, p := range policies {
		s.ContextOverrides[name] = PolicyOverride{Enabled: &p.Enabled, SignalHistory: &p.SignalHistory, RetentionDays: &p.RetentionDays}
		s.Contexts[name] = ContextIdentity{SignalEpoch: p.SignalEpoch, Revision: p.Revision}
	}
	return SaveSettings(dir, s)
}
func LoadPolicies(dir string) (map[string]Policy, error) {
	s, err := LoadSettings(dir)
	if err != nil {
		return nil, err
	}
	out := map[string]Policy{}
	for name := range s.Contexts {
		out[name] = s.Effective(name)
	}
	return out, nil
}
