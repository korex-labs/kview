package dataplane

import (
	"encoding/json"
	"reflect"
	"testing"
)

// Populate every field so newly added mutable policy fields automatically join
// the ownership check. Reflection is test-only; production clones stay typed.
func populatedPolicyValue(t *testing.T, typ reflect.Type) reflect.Value {
	t.Helper()
	v := reflect.New(typ).Elem()
	switch typ.Kind() {
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			v.Field(i).Set(populatedPolicyValue(t, typ.Field(i).Type))
		}
	case reflect.Pointer:
		v.Set(reflect.New(typ.Elem()))
		v.Elem().Set(populatedPolicyValue(t, typ.Elem()))
	case reflect.Map:
		v.Set(reflect.MakeMap(typ))
		v.SetMapIndex(reflect.ValueOf("fixture").Convert(typ.Key()), populatedPolicyValue(t, typ.Elem()))
	case reflect.Slice:
		v.Set(reflect.MakeSlice(typ, 1, 1))
		v.Index(0).Set(populatedPolicyValue(t, typ.Elem()))
	case reflect.String:
		v.SetString("fixture")
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int:
		v.SetInt(42)
	default:
		t.Fatalf("unhandled policy field type %s", typ)
	}
	return v
}

func assertPolicyDisjoint(t *testing.T, a, b reflect.Value, path string) {
	t.Helper()
	switch a.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice:
		if a.IsNil() || b.IsNil() {
			return
		}
		if (a.Kind() != reflect.Slice || a.Len() > 0) && a.Pointer() == b.Pointer() {
			t.Errorf("shared mutable storage: %s", path)
		}
	}
	switch a.Kind() {
	case reflect.Struct:
		for i := 0; i < a.NumField(); i++ {
			assertPolicyDisjoint(t, a.Field(i), b.Field(i), path+"."+a.Type().Field(i).Name)
		}
	case reflect.Pointer:
		if !a.IsNil() && !b.IsNil() {
			assertPolicyDisjoint(t, a.Elem(), b.Elem(), path+"*")
		}
	case reflect.Map:
		for _, key := range a.MapKeys() {
			if bv := b.MapIndex(key); bv.IsValid() {
				assertPolicyDisjoint(t, a.MapIndex(key), bv, path+"["+key.String()+"]")
			}
		}
	case reflect.Slice:
		for i := 0; i < a.Len() && i < b.Len(); i++ {
			assertPolicyDisjoint(t, a.Index(i), b.Index(i), path+"[]")
		}
	}
}

func assertPolicyClone(t *testing.T, input DataplanePolicyBundle) {
	t.Helper()
	cloned := CloneDataplanePolicyBundle(input)
	if !reflect.DeepEqual(input, cloned) {
		t.Fatal("clone changed values or nil/empty representation")
	}
	before, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	after, err := json.Marshal(cloned)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("clone changed JSON: %s -> %s", before, after)
	}
	assertPolicyDisjoint(t, reflect.ValueOf(input), reflect.ValueOf(cloned), "bundle")
}

func TestCloneDataplanePolicyBundleAllMutableFields(t *testing.T) {
	input := populatedPolicyValue(t, reflect.TypeFor[DataplanePolicyBundle]()).Interface().(DataplanePolicyBundle)
	assertPolicyClone(t, input)
}

func TestCloneDataplanePolicyBundleNilAndEmpty(t *testing.T) {
	for _, empty := range []bool{false, true} {
		t.Run(map[bool]string{false: "nil", true: "empty"}[empty], func(t *testing.T) {
			var warm []string
			var ttls map[string]*int
			var signals map[string]SignalOverride
			var contexts map[string]map[string]SignalOverride
			var rules []SignalExclusionRule
			var conditions []SignalExclusionCondition
			if empty {
				warm = []string{}
				ttls = map[string]*int{}
				signals = map[string]SignalOverride{}
				contexts = map[string]map[string]SignalOverride{}
				rules = []SignalExclusionRule{}
				conditions = []SignalExclusionCondition{}
			}
			input := DataplanePolicyBundle{ContextOverrides: map[string]DataplanePolicyOverride{"ctx": {
				Snapshots:           &SnapshotPolicyOverride{TTLSeconds: ttls},
				NamespaceEnrichment: &NamespaceEnrichmentPolicyOverride{WarmResourceKinds: &warm},
				Signals:             &SignalsPolicyOverride{Overrides: signals, ContextOverrides: contexts},
			}}}
			input.Global.NamespaceEnrichment.WarmResourceKinds = warm
			input.Global.Signals.Overrides = signals
			input.Global.Signals.ContextOverrides = contexts
			assertPolicyClone(t, input)
			input.ContextOverrides["ctx"].Snapshots.TTLSeconds = map[string]*int{"clear": nil}
			input.ContextOverrides["ctx"].Signals.Overrides = map[string]SignalOverride{"rules": {Exclusions: &SignalExclusionSet{Rules: rules}}, "conditions": {Exclusions: &SignalExclusionSet{Rules: []SignalExclusionRule{{Conditions: conditions}}}}}
			input.ContextOverrides["ctx"].Signals.ContextOverrides = map[string]map[string]SignalOverride{"nested": signals}
			assertPolicyClone(t, input)
		})
	}
	assertPolicyClone(t, DataplanePolicyBundle{})
	assertPolicyClone(t, DataplanePolicyBundle{ContextOverrides: map[string]DataplanePolicyOverride{}})
}

func TestValidateDataplanePolicyBundleOwnsOverrides(t *testing.T) {
	input := DefaultDataplanePolicyBundle()
	input.ContextOverrides = map[string]DataplanePolicyOverride{"ctx": populatedPolicyValue(t, reflect.TypeFor[DataplanePolicyOverride]()).Interface().(DataplanePolicyOverride)}
	before, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	normalized := ValidateDataplanePolicyBundle(input)
	if len(normalized.ContextOverrides) != 1 {
		t.Fatal("fixture override was dropped")
	}
	assertPolicyDisjoint(t, reflect.ValueOf(input), reflect.ValueOf(normalized), "normalized")
	after, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("normalization mutated input")
	}
}
