package dataplane

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	maxSignalExclusionRules      = 50
	maxSignalExclusionConditions = 8
	maxSignalExclusionPatternLen = 512
	maxSignalExclusionKeyLen     = 253
	maxSignalExclusionDescLen    = 200
	maxSignalExclusionIDLen      = 80
)

// SignalExclusionSet is pointer-owned by SignalOverride so nil means inherit,
// while a non-nil set with no rules explicitly disables inherited exclusions.
type SignalExclusionSet struct {
	Rules []SignalExclusionRule `json:"rules"`
}

type SignalExclusionRule struct {
	ID          string                     `json:"id"`
	Enabled     *bool                      `json:"enabled,omitempty"`
	Description string                     `json:"description,omitempty"`
	Match       string                     `json:"match,omitempty"` // all | any
	Conditions  []SignalExclusionCondition `json:"conditions"`
}

type SignalExclusionCondition struct {
	Source   string `json:"source"`             // name | namespace | label | annotation
	Operator string `json:"operator,omitempty"` // regex | exists
	Key      string `json:"key,omitempty"`
	Pattern  string `json:"pattern,omitempty"`
	Flags    string `json:"flags,omitempty"`
}

func ValidateSignalExclusions(bundle DataplanePolicyBundle) error {
	if err := validateSignalOverrideMapExclusions("global", bundle.Global.Signals.Overrides); err != nil {
		return err
	}
	for contextName, override := range bundle.ContextOverrides {
		if override.Signals == nil {
			continue
		}
		if err := validateSignalOverrideMapExclusions("context "+contextName, override.Signals.Overrides); err != nil {
			return err
		}
		for legacyContext, overrides := range override.Signals.ContextOverrides {
			if err := validateSignalOverrideMapExclusions("context "+legacyContext, overrides); err != nil {
				return err
			}
		}
	}
	for contextName, overrides := range bundle.Global.Signals.ContextOverrides {
		if err := validateSignalOverrideMapExclusions("context "+contextName, overrides); err != nil {
			return err
		}
	}
	return nil
}

func validateSignalOverrideMapExclusions(scope string, overrides map[string]SignalOverride) error {
	for signalType, override := range overrides {
		if override.Exclusions == nil {
			continue
		}
		if !knownDashboardSignalType(signalType) {
			return fmt.Errorf("%s signal %s exclusions: unknown signal type", scope, signalType)
		}
		if err := validateSignalExclusionSet(*override.Exclusions); err != nil {
			return fmt.Errorf("%s signal %s exclusions: %w", scope, signalType, err)
		}
	}
	return nil
}

func validateSignalExclusionSet(set SignalExclusionSet) error {
	if len(set.Rules) > maxSignalExclusionRules {
		return fmt.Errorf("at most %d rules are allowed", maxSignalExclusionRules)
	}
	seen := map[string]struct{}{}
	for i, rule := range set.Rules {
		id := strings.TrimSpace(rule.ID)
		if id == "" {
			return fmt.Errorf("rule %d has no id", i+1)
		}
		if len(id) > maxSignalExclusionIDLen {
			return fmt.Errorf("rule id exceeds %d characters", maxSignalExclusionIDLen)
		}
		if _, ok := seen[id]; ok {
			return fmt.Errorf("duplicate rule id %q", id)
		}
		seen[id] = struct{}{}
		if len(rule.Description) > maxSignalExclusionDescLen {
			return fmt.Errorf("rule %q description exceeds %d characters", id, maxSignalExclusionDescLen)
		}
		match := strings.TrimSpace(rule.Match)
		if match != "" && match != "all" && match != "any" {
			return fmt.Errorf("rule %q has unsupported match mode %q", id, match)
		}
		if len(rule.Conditions) == 0 {
			return fmt.Errorf("rule %q has no conditions", id)
		}
		if len(rule.Conditions) > maxSignalExclusionConditions {
			return fmt.Errorf("rule %q exceeds %d conditions", id, maxSignalExclusionConditions)
		}
		for j, condition := range rule.Conditions {
			if err := validateSignalExclusionCondition(condition); err != nil {
				return fmt.Errorf("rule %q condition %d: %w", id, j+1, err)
			}
		}
	}
	return nil
}

func validateSignalExclusionCondition(condition SignalExclusionCondition) error {
	source := strings.TrimSpace(condition.Source)
	switch source {
	case "name", "namespace", "label", "annotation":
	default:
		return fmt.Errorf("unsupported source %q", source)
	}
	key := strings.TrimSpace(condition.Key)
	if source == "label" || source == "annotation" {
		if key == "" {
			return fmt.Errorf("%s key is required", source)
		}
		if len(key) > maxSignalExclusionKeyLen {
			return fmt.Errorf("key exceeds %d characters", maxSignalExclusionKeyLen)
		}
	} else if key != "" {
		return fmt.Errorf("key is only valid for label or annotation sources")
	}
	operator := strings.TrimSpace(condition.Operator)
	if operator == "" {
		operator = "regex"
	}
	switch operator {
	case "exists":
		if source != "label" && source != "annotation" {
			return fmt.Errorf("exists is only valid for label or annotation sources")
		}
		if condition.Pattern != "" || condition.Flags != "" {
			return fmt.Errorf("exists does not accept pattern or flags")
		}
	case "regex":
		if condition.Pattern == "" {
			return fmt.Errorf("regex pattern is required")
		}
		if len(condition.Pattern) > maxSignalExclusionPatternLen {
			return fmt.Errorf("pattern exceeds %d characters", maxSignalExclusionPatternLen)
		}
		if _, err := regexp.Compile(signalExclusionRegexPattern(condition.Pattern, condition.Flags)); err != nil {
			return fmt.Errorf("invalid regex: %w", err)
		}
	default:
		return fmt.Errorf("unsupported operator %q", operator)
	}
	for _, flag := range condition.Flags {
		if !strings.ContainsRune("ims", flag) {
			return fmt.Errorf("unsupported regex flag %q", string(flag))
		}
	}
	return nil
}

func normalizeSignalExclusionSet(in *SignalExclusionSet) *SignalExclusionSet {
	if in == nil {
		return nil
	}
	out := &SignalExclusionSet{Rules: make([]SignalExclusionRule, 0, len(in.Rules))}
	seen := map[string]struct{}{}
	for _, raw := range in.Rules {
		if len(out.Rules) >= maxSignalExclusionRules {
			break
		}
		id := strings.TrimSpace(raw.ID)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		rule := SignalExclusionRule{ID: id, Enabled: cloneBool(raw.Enabled)}
		rule.Description = strings.TrimSpace(raw.Description)
		if len(rule.Description) > maxSignalExclusionDescLen {
			rule.Description = rule.Description[:maxSignalExclusionDescLen]
		}
		rule.Match = strings.TrimSpace(raw.Match)
		if rule.Match != "any" {
			rule.Match = "all"
		}
		for _, condition := range raw.Conditions {
			if len(rule.Conditions) >= maxSignalExclusionConditions {
				break
			}
			condition = normalizeSignalExclusionCondition(condition)
			if validateSignalExclusionCondition(condition) == nil {
				rule.Conditions = append(rule.Conditions, condition)
			}
		}
		if len(rule.Conditions) > 0 {
			out.Rules = append(out.Rules, rule)
		}
	}
	return out
}

func normalizeSignalExclusionCondition(in SignalExclusionCondition) SignalExclusionCondition {
	out := SignalExclusionCondition{
		Source:   strings.TrimSpace(in.Source),
		Operator: strings.TrimSpace(in.Operator),
		Key:      strings.TrimSpace(in.Key),
		Pattern:  in.Pattern,
	}
	if out.Operator == "" {
		out.Operator = "regex"
	}
	for _, flag := range "ims" {
		if strings.ContainsRune(in.Flags, flag) {
			out.Flags += string(flag)
		}
	}
	if out.Operator == "exists" {
		out.Pattern = ""
		out.Flags = ""
	}
	return out
}

func cloneSignalExclusionSet(in *SignalExclusionSet) *SignalExclusionSet {
	if in == nil {
		return nil
	}
	out := &SignalExclusionSet{Rules: make([]SignalExclusionRule, len(in.Rules))}
	for i, rule := range in.Rules {
		out.Rules[i] = rule
		out.Rules[i].Enabled = cloneBool(rule.Enabled)
		out.Rules[i].Conditions = append([]SignalExclusionCondition(nil), rule.Conditions...)
	}
	return out
}

func cloneBool(in *bool) *bool {
	if in == nil {
		return nil
	}
	value := *in
	return &value
}

type compiledSignalExclusionSet struct {
	rules []compiledSignalExclusionRule
}

type compiledSignalExclusionRule struct {
	matchAny   bool
	conditions []compiledSignalExclusionCondition
}

type compiledSignalExclusionCondition struct {
	source   string
	operator string
	key      string
	re       *regexp.Regexp
}

func compileSignalExclusionSet(set *SignalExclusionSet) compiledSignalExclusionSet {
	var out compiledSignalExclusionSet
	if set == nil {
		return out
	}
	for _, rule := range set.Rules {
		if rule.Enabled != nil && !*rule.Enabled {
			continue
		}
		compiled := compiledSignalExclusionRule{matchAny: rule.Match == "any"}
		valid := true
		for _, condition := range rule.Conditions {
			item := compiledSignalExclusionCondition{source: condition.Source, operator: condition.Operator, key: condition.Key}
			if item.operator == "" {
				item.operator = "regex"
			}
			if item.operator == "regex" {
				re, err := regexp.Compile(signalExclusionRegexPattern(condition.Pattern, condition.Flags))
				if err != nil {
					valid = false
					break
				}
				item.re = re
			}
			compiled.conditions = append(compiled.conditions, item)
		}
		if valid && len(compiled.conditions) > 0 {
			out.rules = append(out.rules, compiled)
		}
	}
	return out
}

func (set compiledSignalExclusionSet) excludes(item ClusterDashboardSignal) bool {
	for _, rule := range set.rules {
		if rule.matches(item) {
			return true
		}
	}
	return false
}

func (rule compiledSignalExclusionRule) matches(item ClusterDashboardSignal) bool {
	for _, condition := range rule.conditions {
		matched := condition.matches(item)
		if rule.matchAny && matched {
			return true
		}
		if !rule.matchAny && !matched {
			return false
		}
	}
	return len(rule.conditions) > 0 && !rule.matchAny
}

func (condition compiledSignalExclusionCondition) matches(item ClusterDashboardSignal) bool {
	var value string
	var values map[string]string
	switch condition.source {
	case "name":
		value = item.ResourceName
		if value == "" {
			value = item.Name
		}
	case "namespace":
		value = item.Namespace
		if value == "" && item.Scope == "namespace" {
			value = item.ScopeLocation
		}
	case "label":
		values = item.MatchLabels
		if values == nil {
			values = item.Labels
		}
	case "annotation":
		values = item.MatchAnnotations
		if values == nil {
			values = item.Annotations
		}
	default:
		return false
	}
	if condition.source == "label" || condition.source == "annotation" {
		var ok bool
		value, ok = values[condition.key]
		if condition.operator == "exists" {
			return ok
		}
		if !ok {
			return false
		}
	}
	return condition.re != nil && condition.re.MatchString(value)
}

func signalExclusionRuleMatches(item ClusterDashboardSignal, rule SignalExclusionRule) bool {
	return compileSignalExclusionSet(&SignalExclusionSet{Rules: []SignalExclusionRule{rule}}).excludes(item)
}

func signalExclusionRegexPattern(pattern, flags string) string {
	prefix := ""
	for _, flag := range "ims" {
		if strings.ContainsRune(flags, flag) {
			prefix += string(flag)
		}
	}
	if prefix == "" {
		return pattern
	}
	return "(?" + prefix + ")" + pattern
}
